//! 性能验收（Q-01）装置。
//!
//! 两条腿，共用同一份「验收数据集」：
//!
//! - **运行时**：[`mark_start`] 在 `run()` 第一行记下进程起点；前端把「页面内
//!   计时 + 每条命令的往返耗时」经 `perf:ready` 交回来，本模块在 `ORDO_PERF=1`
//!   时把几行 `[perf]` 打到 stdout（GUI 进程没有控制台，验收脚本用重定向收）。
//! - **验收测试**：本模块的 `#[ignore]` 测试把数据集灌进库里，逐条命令量服务层
//!   往返（含响应 JSON 序列化），并把它写成真实库文件供启动计时使用。
//!
//! 怎么跑见 [ARCHITECTURE](../../docs/ARCHITECTURE.md)§6。

use std::sync::OnceLock;
use std::time::Instant;

use serde::Deserialize;

/// 进程起点，由 `run()` 第一行的 [`mark_start`] 写入。
static START: OnceLock<Instant> = OnceLock::new();

/// 记下进程起点；重复调用不会改动第一次的标记。
pub fn mark_start() {
    let _ = START.set(Instant::now());
}

/// 从进程起点到现在的毫秒数；[`mark_start`] 之前是 `None`。
pub fn elapsed_ms() -> Option<f64> {
    START
        .get()
        .map(|start| start.elapsed().as_secs_f64() * 1000.0)
}

/// 验收运行开关（`ORDO_PERF=1`）。关着时一行都不打，正常使用完全静默。
fn enabled() -> bool {
    std::env::var("ORDO_PERF").is_ok_and(|value| value != "0")
}

/// 打一行 `[perf]`；没开验收就什么都不做。
pub fn note(label: &str, ms: f64) {
    if enabled() {
        println!("[perf] {label} : {ms:.0} ms");
    }
}

/// 打一行「进程起点 → 这里」的 `[perf]`：启动路径上的分界点标记。
pub fn note_now(label: &str) {
    if let Some(ms) = elapsed_ms() {
        note(label, ms);
    }
}

/// 页面内的一个时刻，单位 ms，**从导航开始**（`performance.now()` 的绝对值）。
#[derive(Debug, Deserialize)]
pub struct PageMark {
    pub name: String,
    pub ms: f64,
}

/// 前端上报的单条命令耗时（IPC + 后端 + 响应反序列化）。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandSamples {
    pub name: String,
    pub count: u64,
    pub total_ms: f64,
    pub max_ms: f64,
}

/// 前端在首屏可交互时上报的内容。
#[derive(Debug, Deserialize)]
pub struct StartupReport {
    pub marks: Vec<PageMark>,
    pub commands: Vec<CommandSamples>,
}

/// `perf:ready` 的落点：把启动时间线（Rust 侧 + 页面侧）与命令往返表打到 stdout。
pub fn report_startup(mut report: StartupReport) {
    if !enabled() {
        return;
    }
    if let Some(interactive) = elapsed_ms() {
        println!("[perf] startup-to-interactive : {interactive:.0} ms  (进程启动 → 首屏可交互)");
    }
    report.marks.sort_by(|a, b| a.ms.total_cmp(&b.ms));
    if let Some(last) = report.marks.last() {
        println!(
            "[perf] page-to-interactive : {:.0} ms  (导航 → 首屏可交互)",
            last.ms
        );
    }
    for mark in &report.marks {
        println!("[perf]   page {:<18} {:.0} ms", mark.name, mark.ms);
    }
    report
        .commands
        .sort_by(|a, b| b.max_ms.total_cmp(&a.max_ms));
    println!("[perf] command-roundtrip (IPC + 后端 + 响应反序列化):");
    for sample in &report.commands {
        let avg = if sample.count == 0 {
            0.0
        } else {
            sample.total_ms / sample.count as f64
        };
        println!(
            "[perf]   {:<22} n={:<3} avg={:.1} ms  max={:.1} ms",
            sample.name, sample.count, avg, sample.max_ms
        );
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::time::Instant;

    use chrono::{Duration, Utc};
    use rusqlite::Connection;
    use uuid::Uuid;

    use crate::db;
    use crate::models::{
        Dependency, Namespace, NewComment, NewNamespace, NewProject, NewTag, NewTask, NewTimeEntry,
        Patch, Priority, StatsGranularity, Tag, Task, TimeDistributionQuery, TimeGroupBy,
        TrendQuery, UpdateTask,
    };
    use crate::services;

    // 验收数据集规模：一个「用了两年」的库。这些数字就是验收记录里引用的规模，
    // 改了它们就要重跑验收。
    const NAMESPACES: usize = 6;
    const PROJECTS: usize = 40;
    const TASKS_PER_PROJECT: usize = 50;
    const TAGS: usize = 60;
    /// 每 5 个顶层任务挂 1 个子任务。
    const CHILD_EVERY: usize = 5;
    const DEPENDENCY_EDGES: usize = 500;

    /// 命令往返预算：NFR 的「任务/项目操作 < 50ms」，统计另按「秒级」算。
    const BUDGET_MS: f64 = 50.0;
    const STATS_BUDGET_MS: f64 = 1000.0;
    /// 每条命令的轮数。
    const ROUNDS: usize = 20;

    /// 数据集里反复用到的那几行。
    struct Fixture {
        project: Uuid,
        column_id: Uuid,
        /// 已经落在 `column_id` 里、全程不动，作为 `board:moveTask` 的后继。
        column_anchor: String,
        /// 反复移进同一列的任务。
        column_mover: Uuid,
        /// 普通顶层任务，供 `task:update` 改。
        task: Uuid,
        /// 子任务范围里全程不动的那一个，作为 `task:reorder` 的前驱。
        child_anchor: String,
        /// 反复重排的子任务。
        child_mover: Uuid,
        /// 供 `task:complete` 逐个消耗的待完成任务。
        pending: Vec<Uuid>,
    }

    /// 确定性伪随机：验收数据集必须每次一模一样，为这个不引 `rand`。
    struct Rng(u64);

    impl Rng {
        fn next(&mut self) -> u64 {
            self.0 = self
                .0
                .wrapping_mul(6364136223846793005)
                .wrapping_add(1442695040888963407);
            self.0 >> 33
        }

        fn below(&mut self, n: u64) -> u64 {
            self.next() % n
        }
    }

    /// 只填标题的 `NewTask`；其余字段由调用方按需覆盖。
    fn draft(title: String) -> NewTask {
        NewTask {
            title,
            note: None,
            priority: None,
            project_id: None,
            column_id: None,
            due_at: None,
            tag_ids: Vec::new(),
            subtask_titles: Vec::new(),
            repeat_rule: None,
            complexity: None,
            parent_task_id: None,
        }
    }

    /// 灌入验收数据集。走真实服务层，所以排序键、标签关联、FTS 索引、完成时间
    /// 都是用户库里的样子。
    fn seed(conn: &Connection) -> Fixture {
        let mut rng = Rng(2026_0916);
        let now = Utc::now();

        let namespaces: Vec<Namespace> = (0..NAMESPACES)
            .map(|i| {
                services::create_namespace(
                    conn,
                    NewNamespace {
                        name: format!("命名空间 {i}"),
                        description: None,
                        color: None,
                        icon: None,
                    },
                )
                .unwrap()
            })
            .collect();
        let tags: Vec<Tag> = (0..TAGS)
            .map(|i| {
                services::create_tag(
                    conn,
                    NewTag {
                        name: format!("标签 {i}"),
                        color: None,
                    },
                )
                .unwrap()
            })
            .collect();

        // 依赖边只连顶层任务（同一父任务下才允许连边），且只从后往前连，天然无环。
        let mut pool: Vec<Uuid> = Vec::new();
        let mut fixture_task = Uuid::nil();
        let mut fixture_children: Vec<Task> = Vec::new();
        let mut project_zero = Uuid::nil();
        let mut column_id = Uuid::nil();
        let mut column_anchor_key = String::new();
        let mut column_mover = Uuid::nil();

        for p in 0..PROJECTS {
            let project = services::create_project(
                conn,
                NewProject {
                    name: format!("项目 {p}"),
                    description: Some("验收数据集".into()),
                    color: None,
                    icon: None,
                    namespace_id: Some(namespaces[p % NAMESPACES].id),
                },
            )
            .unwrap();
            let columns = services::list_board_columns(conn, project.id).unwrap();
            if p == 0 {
                project_zero = project.id;
                column_id = columns[1].id;
            }

            for t in 0..TASKS_PER_PROJECT {
                let task = services::create_task(
                    conn,
                    NewTask {
                        title: format!("项目 {p} 的任务 {t}"),
                        note: (t % 3 == 0).then(|| {
                            format!("第 {t} 条备注：验收数据集里的正文，让搜索有东西可搜")
                        }),
                        priority: Some(match t % 4 {
                            0 => Priority::High,
                            1 => Priority::Medium,
                            2 => Priority::Low,
                            _ => Priority::None,
                        }),
                        project_id: Some(project.id),
                        // 一半带截止时间、散在前后的 20 天里：今天/即将到来/提醒
                        // 扫描都有东西可扫。
                        due_at: (t % 2 == 0)
                            .then(|| now + Duration::days(rng.below(40) as i64 - 20)),
                        tag_ids: vec![tags[(p + t) % TAGS].id],
                        complexity: Some((t % 5) as i64 + 1),
                        ..draft(String::new())
                    },
                )
                .unwrap();
                pool.push(task.id);
                if p == 0 && t == 0 {
                    fixture_task = task.id;
                }

                // 第一个任务多挂几个子任务：里头两个全程不动，供重排反复用。
                let children = if p == 0 && t == 0 {
                    5
                } else if t % CHILD_EVERY == 0 {
                    2
                } else {
                    0
                };
                for c in 0..children {
                    let child = services::create_task(
                        conn,
                        NewTask {
                            parent_task_id: Some(task.id),
                            title: format!("项目 {p} 任务 {t} 的子任务 {c}"),
                            ..draft(String::new())
                        },
                    )
                    .unwrap();
                    if p == 0 && t == 0 {
                        fixture_children.push(child);
                    }
                }

                if t % 3 == 0 {
                    services::complete_task(conn, task.id).unwrap();
                }
                if t % 4 == 0 {
                    services::create_comment(
                        conn,
                        task.id,
                        NewComment {
                            body: format!("第 {t} 条评论：验收数据集里的讨论内容"),
                        },
                    )
                    .unwrap();
                }
                if t % 5 == 0 {
                    services::create_time_entry(
                        conn,
                        task.id,
                        NewTimeEntry {
                            started_at: now - Duration::hours(rng.below(200) as i64),
                            duration: 600 + (rng.below(8) as i64) * 300,
                        },
                    )
                    .unwrap();
                }
            }
        }

        let step = (pool.len() / DEPENDENCY_EDGES).max(1);
        for i in (step..pool.len()).step_by(step).take(DEPENDENCY_EDGES) {
            services::add_dependency(
                conn,
                Dependency {
                    dependent_id: pool[i],
                    prerequisite_id: pool[i - step],
                },
            )
            .unwrap();
        }

        // 看板列里的两行：一个锚点（不动）、一个反复移动。
        let columns = services::list_board_columns(conn, project_zero).unwrap();
        for index in 0..2 {
            let task = services::create_task(
                conn,
                NewTask {
                    title: format!("列内{}", if index == 0 { "锚点" } else { "移动" }),
                    project_id: Some(project_zero),
                    column_id: Some(columns[1].id),
                    ..draft(String::new())
                },
            )
            .unwrap();
            if index == 0 {
                column_anchor_key = task.sort_order;
            } else {
                column_mover = task.id;
            }
        }

        // 待完成任务：`task:complete` 每轮消耗一个（把已完成的再完成一遍是空转，
        // 量不出东西）。
        let pending = (0..ROUNDS)
            .map(|i| {
                services::create_task(
                    conn,
                    NewTask {
                        title: format!("待完成 {i}"),
                        project_id: Some(project_zero),
                        ..draft(String::new())
                    },
                )
                .unwrap()
                .id
            })
            .collect();

        Fixture {
            project: project_zero,
            column_id,
            column_anchor: column_anchor_key,
            column_mover,
            task: fixture_task,
            child_anchor: fixture_children[0].sort_order.clone(),
            child_mover: fixture_children[4].id,
            pending,
        }
    }

    /// 跑 `ROUNDS` 轮，打印平均/最大，超预算就记进 `over`（不在这里断言：一条命令
    /// 超预算不该让后面的命令量不到，最后一起报）。
    ///
    /// 每轮都把响应 `serde_json::to_string`——跨 IPC 的正是这个字符串；不预热，
    /// 第一轮就是用户真正会遇到的那一轮。判平均而不是最大：共享机器上单次毛刺
    /// 不可控，最大值照样打印出来供人判断。
    fn timed<T: serde::Serialize>(
        label: &str,
        budget_ms: f64,
        over: &mut Vec<String>,
        mut run: impl FnMut() -> T,
    ) {
        let mut total = 0.0;
        let mut worst = 0.0_f64;
        for _ in 0..ROUNDS {
            let started = Instant::now();
            let value = run();
            let payload = serde_json::to_string(&value).expect("响应可以序列化");
            let ms = started.elapsed().as_secs_f64() * 1000.0;
            std::hint::black_box(&payload);
            total += ms;
            worst = worst.max(ms);
        }
        let avg = total / ROUNDS as f64;
        println!(
            "[perf]   {label:<22} avg={avg:6.2} ms  max={worst:6.2} ms  (预算 {budget_ms:.0} ms)"
        );
        if avg > budget_ms {
            over.push(format!(
                "{label} 平均 {avg:.2} ms 超出预算 {budget_ms:.0} ms（max {worst:.2} ms）"
            ));
        }
    }

    /// 每条命令的服务层往返预算。跑法见本模块文档注释。
    #[test]
    #[ignore = "性能验收：cargo test --release perf -- --ignored --nocapture"]
    fn command_roundtrips_stay_inside_budget() {
        let conn = db::test_conn();
        let fixture = seed(&conn);
        let rows: i64 = conn
            .query_row("SELECT COUNT(*) FROM tasks", [], |row| row.get(0))
            .unwrap();
        println!(
            "[perf] dataset: {NAMESPACES} 命名空间 / {PROJECTS} 项目 / {TAGS} 标签 / {rows} 任务行 / {DEPENDENCY_EDGES} 依赖边"
        );
        println!("[perf] command-roundtrip (服务层 + 响应序列化, {ROUNDS} 轮/命令):");

        let mut over: Vec<String> = Vec::new();

        timed("task:list", BUDGET_MS, &mut over, || {
            services::list_tasks(&conn).unwrap()
        });
        timed("tag:list", BUDGET_MS, &mut over, || {
            services::list_tags(&conn).unwrap()
        });
        timed("project:list", BUDGET_MS, &mut over, || {
            services::list_projects(&conn).unwrap()
        });
        timed("namespace:list", BUDGET_MS, &mut over, || {
            services::list_namespaces(&conn).unwrap()
        });
        timed("dependency:listAll", BUDGET_MS, &mut over, || {
            services::list_dependencies(&conn).unwrap()
        });
        timed("board:listColumns", BUDGET_MS, &mut over, || {
            services::list_board_columns(&conn, fixture.project).unwrap()
        });
        timed("search:query", BUDGET_MS, &mut over, || {
            services::search(&conn, "项目").unwrap()
        });

        let mut created = 0usize;
        timed("task:create", BUDGET_MS, &mut over, || {
            created += 1;
            services::create_task(
                &conn,
                NewTask {
                    title: format!("验收新建 {created}"),
                    project_id: Some(fixture.project),
                    ..draft(String::new())
                },
            )
            .unwrap()
        });
        timed("task:update", BUDGET_MS, &mut over, || {
            services::update_task(
                &conn,
                fixture.task,
                UpdateTask {
                    title: Some("验收改过的标题".into()),
                    priority: Some(Priority::Medium),
                    tag_ids: Some(Vec::new()),
                    note: Patch::Unchanged,
                    project_id: Patch::Unchanged,
                    column_id: Patch::Unchanged,
                    due_at: Patch::Unchanged,
                    complexity: Patch::Unchanged,
                    completed_at: Patch::Unchanged,
                    repeat_rule: Patch::Unchanged,
                    parent_task_id: Patch::Unchanged,
                },
            )
            .unwrap()
        });
        let mut pending = fixture.pending.iter().copied();
        timed("task:complete", BUDGET_MS, &mut over, || {
            let id = pending.next().expect("待完成任务够 {ROUNDS} 轮");
            services::complete_task(&conn, id).unwrap()
        });
        timed("task:reorder", BUDGET_MS, &mut over, || {
            services::reorder_task(
                &conn,
                fixture.child_mover,
                Some(fixture.child_anchor.clone()),
                None,
            )
            .unwrap()
        });
        timed("board:moveTask", BUDGET_MS, &mut over, || {
            services::move_task(
                &conn,
                fixture.column_mover,
                fixture.column_id,
                None,
                Some(fixture.column_anchor.clone()),
            )
            .unwrap()
        });
        let mut projects_created = 0usize;
        timed("project:create", BUDGET_MS, &mut over, || {
            projects_created += 1;
            services::create_project(
                &conn,
                NewProject {
                    name: format!("验收项目 {projects_created}"),
                    description: None,
                    color: None,
                    icon: None,
                    namespace_id: None,
                },
            )
            .unwrap()
        });

        let to = Utc::now() + Duration::days(1);
        let from = to - Duration::days(30);
        timed("stats:trend", STATS_BUDGET_MS, &mut over, || {
            services::completion_trend(
                &conn,
                TrendQuery {
                    from,
                    to,
                    granularity: StatsGranularity::Day,
                    offset_minutes: 0,
                },
            )
            .unwrap()
        });
        timed("stats:projectProgress", STATS_BUDGET_MS, &mut over, || {
            services::project_progress(&conn).unwrap()
        });
        timed("stats:timeDistribution", STATS_BUDGET_MS, &mut over, || {
            services::time_distribution(
                &conn,
                TimeDistributionQuery {
                    group_by: TimeGroupBy::Project,
                    from,
                    to,
                    granularity: StatsGranularity::Day,
                    offset_minutes: 0,
                },
            )
            .unwrap()
        });

        assert!(over.is_empty(), "超预算：\n{}", over.join("\n"));
    }

    /// 验收库文件：`scripts/perf-acceptance.ps1` 用 `ORDO_DB` 指向它量启动。
    fn acceptance_db_path() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("target/perf/ordo.db")
    }

    /// 把验收数据集写成一个真实库文件：启动计时必须跑在有数据的库上，空库谁都能过。
    #[test]
    #[ignore = "性能验收：cargo test --release perf -- --ignored --nocapture"]
    fn write_acceptance_database() {
        let path = acceptance_db_path();
        std::fs::create_dir_all(path.parent().expect("库文件有父目录")).unwrap();
        for suffix in ["", "-wal", "-shm", "-journal"] {
            let _ = std::fs::remove_file(format!("{}{suffix}", path.display()));
        }
        let db = db::init(&path).unwrap();
        seed(&db.lock().unwrap());
        println!("[perf] acceptance database: {}", path.display());
    }
}
