//! Lexicographic sort keys (fractional indexing) for manual ordering.
//!
//! Keys are non-empty strings over `['a'..='z']`; plain byte-wise string
//! comparison matches key order, which is also how SQLite orders TEXT
//! columns, so `ORDER BY sort_order` needs no custom collation.
//!
//! List positions are stored as such keys (`tasks.sort_order`,
//! `subtasks.sort_order`, `board_columns.position`). The frontend sends the
//! predecessor/successor keys of the target slot; the backend derives the new
//! key with [`between`], or [`before`]/[`after`] at the list ends.
//!
//! The alphabet is finite, so occasionally no intermediate key exists (e.g.
//! between `"a"` and `"aa"`). Such calls return [`SortError::Exhausted`]; the
//! caller then regenerates every sibling key in the currently stored order
//! with [`spread`] and retries — a local rebalance that also keeps key
//! lengths bounded. The same rebalance is the answer to key growth: long
//! runs of [`after`] descend into the `'z'` corner (roughly one extra
//! character per 13+ consecutive appends), so services should rekey a list
//! with [`spread`] once its keys exceed a length threshold.

use crate::error::AppError;
use thiserror::Error;

/// Size of the key alphabet: 'a' == 0 ..= 'z' == 25.
const BASE: u64 = 26;

/// Midpoint digit used when extending a key ('n' == 13).
const MID: u8 = b'n';

/// Failures produced by the sort-key helpers.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum SortError {
    #[error("no sort key fits between the given keys; rebalance the sibling list")]
    Exhausted,
    #[error("invalid sort key {0:?}: must be a non-empty string of 'a'..'z'")]
    InvalidKey(String),
    #[error("sort keys must satisfy a < b")]
    InvalidOrder,
}

/// The key a fresh list starts from.
///
/// The midpoint digit leaves headroom on both sides, so the first few
/// prepends and appends never need a rebalance.
pub fn first() -> String {
    "n".to_string()
}

/// A key smaller than `b`, for inserting before the current minimum.
///
/// Decrements the last digit ("n" -> "m"), dropping trailing 'a's first
/// ("aza" -> "az", "aa" -> "a"); an all-'a' key has no smaller neighbour and
/// returns [`SortError::Exhausted`].
pub fn before(b: &str) -> Result<String, SortError> {
    validate(b)?;
    let stem = b.trim_end_matches('a');
    if stem.is_empty() {
        // Only "a" itself (or an all-'a' run) can land here for lists we
        // produced; "aa"/"aaa" still have the shorter all-'a' prefix.
        if b.len() >= 2 {
            return Ok("a".repeat(b.len() - 1));
        }
        return Err(SortError::Exhausted);
    }
    if stem.len() < b.len() {
        // A strict prefix sorts before the original ("aza" -> "az").
        return Ok(stem.to_string());
    }
    let mut key = String::from(stem);
    let last = key.pop().unwrap() as u8;
    key.push((last - 1) as char);
    Ok(key)
}

/// A key greater than `a`, for inserting after the current maximum.
///
/// Increments the last digit with carry ("az" -> "b"); an all-'z' key grows
/// by one midpoint digit ("z" -> "zn"). Consecutive appends descend the 'z'
/// corner and gain a character every ~13 calls — rebalance with [`spread`]
/// when keys get long (see the module docs).
pub fn after(a: &str) -> Result<String, SortError> {
    validate(a)?;
    let stem_len = a.trim_end_matches('z').len();
    if stem_len == 0 {
        let mut key = String::with_capacity(a.len() + 1);
        key.push_str(a);
        key.push(MID as char);
        return Ok(key);
    }
    let mut key = a[..stem_len].to_string();
    let last = key.pop().unwrap() as u8;
    key.push((last + 1) as char);
    Ok(key)
}

/// A key strictly between `a` and `b` (exclusive on both sides).
///
/// Falls back to extending `a` with the midpoint digit when the differing
/// digits are adjacent; returns [`SortError::Exhausted`] only when no
/// in-between key exists at all (the caller rebalances with [`spread`]).
pub fn between(a: &str, b: &str) -> Result<String, SortError> {
    validate(a)?;
    validate(b)?;
    if a >= b {
        return Err(SortError::InvalidOrder);
    }

    let first_diff = a.bytes().zip(b.bytes()).position(|(x, y)| x != y);
    match first_diff {
        Some(i) => {
            let (da, db) = (a.as_bytes()[i], b.as_bytes()[i]);
            if db - da > 1 {
                // Room at the differing digit: "ab" vs "ad" -> "ac".
                let mut key = String::with_capacity(i + 1);
                key.push_str(&a[..i]);
                key.push((da + 1) as char);
                Ok(key)
            } else {
                // Adjacent digits: extend `a` ("a" vs "b" -> "an");
                // incrementing instead would collide with `b`.
                let mut key = String::with_capacity(a.len() + 1);
                key.push_str(a);
                key.push(MID as char);
                Ok(key)
            }
        }
        None => {
            // `a` is a proper prefix of `b`; find room inside b's tail.
            let tail = &b[a.len()..];
            match tail.find(|c: char| c > 'a') {
                Some(j) => {
                    let mut key = String::with_capacity(a.len() + j + 1);
                    key.push_str(a);
                    key.push_str(&tail[..j]);
                    key.push((tail.as_bytes()[j] - 1) as char);
                    Ok(key)
                }
                None if tail.len() >= 2 => {
                    // "a" vs "aaa" -> "aa".
                    Ok(format!("{a}{}", "a".repeat(tail.len() - 1)))
                }
                None => Err(SortError::Exhausted),
            }
        }
    }
}

/// `count` strictly increasing fresh keys, for rebalancing a sibling list.
///
/// The keys are independent of any existing list: when an insertion hits
/// [`SortError::Exhausted`], the caller replaces every key of the list (in
/// its current stored order) with the result of `spread(len)` and retries the
/// insertion. Keys are centred around the midpoint so both ends keep
/// headroom.
pub fn spread(count: usize) -> Vec<String> {
    if count == 0 {
        return Vec::new();
    }
    // Smallest length whose digit space strictly exceeds the key count.
    let mut len = 1;
    while BASE.pow(len) <= count as u64 {
        len += 1;
    }
    let space = BASE.pow(len);
    let step = space / (count as u64 + 1);
    let start = (space - step * count as u64) / 2;
    (1..=count as u64)
        .map(|i| render(start + i * step, len as usize))
        .collect()
}

/// Renders `index` as a fixed-length base-26 key ('a' == 0); for equal
/// lengths, lexicographic order matches numeric order.
fn render(mut index: u64, len: usize) -> String {
    let mut digits = vec![b'a'; len];
    for slot in digits.iter_mut().rev() {
        *slot = b'a' + (index % BASE) as u8;
        index /= BASE;
    }
    String::from_utf8(digits).expect("digits are ASCII")
}

/// Rejects empty keys and anything outside 'a'..'z'.
pub fn validate(key: &str) -> Result<(), SortError> {
    if key.is_empty() || !key.bytes().all(|b| b.is_ascii_lowercase()) {
        Err(SortError::InvalidKey(key.to_string()))
    } else {
        Ok(())
    }
}

impl From<SortError> for AppError {
    fn from(err: SortError) -> Self {
        AppError::Validation(err.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A tiny deterministic LCG so pseudo-random insertion sequences are
    /// reproducible without pulling in a rand dependency.
    struct Lcg(u64);

    impl Lcg {
        fn next(&mut self) -> u64 {
            self.0 = self
                .0
                .wrapping_mul(6364136223846793005)
                .wrapping_add(1442695040888963407);
            self.0 >> 33
        }
    }

    #[test]
    fn first_is_the_midpoint_key() {
        assert_eq!(first(), "n");
    }

    #[test]
    fn after_increments_with_carry() {
        assert_eq!(after("a").unwrap(), "b");
        assert_eq!(after("m").unwrap(), "n");
        assert_eq!(after("y").unwrap(), "z");
        assert_eq!(after("z").unwrap(), "zn");
        assert_eq!(after("az").unwrap(), "b");
        assert_eq!(after("zz").unwrap(), "zzn");
    }

    #[test]
    fn before_decrements_with_carry() {
        assert_eq!(before("b").unwrap(), "a");
        assert_eq!(before("n").unwrap(), "m");
        assert_eq!(before("az").unwrap(), "ay");
        assert_eq!(before("ab").unwrap(), "aa");
        assert_eq!(before("aza").unwrap(), "az");
        assert_eq!(before("aa").unwrap(), "a");
        assert_eq!(before("aaa").unwrap(), "aa");
    }

    #[test]
    fn before_first_key_is_exhausted() {
        assert_eq!(before("a"), Err(SortError::Exhausted));
    }

    #[test]
    fn between_finds_middle_keys() {
        let cases = [
            ("a", "c", "b"),
            ("a", "b", "an"),
            ("ab", "ad", "ac"),
            ("aa", "ab", "aan"),
            ("a", "ab", "aa"),
            ("a", "aaa", "aa"),
            ("x", "xba", "xa"),
        ];
        for (a, b, expected) in cases {
            assert_eq!(between(a, b).unwrap(), expected, "between({a}, {b})");
        }
    }

    #[test]
    fn between_reports_exhaustion_only_when_no_key_fits() {
        assert_eq!(between("a", "aa"), Err(SortError::Exhausted));
        assert_eq!(between("b", "ba"), Err(SortError::Exhausted));
        assert_eq!(between("an", "ana"), Err(SortError::Exhausted));
    }

    #[test]
    fn between_rejects_bad_input() {
        assert_eq!(between("b", "a"), Err(SortError::InvalidOrder));
        assert_eq!(between("a", "a"), Err(SortError::InvalidOrder));
        assert!(matches!(between("A", "b"), Err(SortError::InvalidKey(_))));
        assert!(matches!(between("", "b"), Err(SortError::InvalidKey(_))));
        assert!(matches!(after("a1"), Err(SortError::InvalidKey(_))));
        assert!(matches!(before("aa "), Err(SortError::InvalidKey(_))));
    }

    /// All key pairs up to length 2: every successful result stays strictly
    /// between, and exhaustion is accepted as a valid outcome.
    #[test]
    fn between_always_stays_between_short_keys() {
        let mut keys = Vec::new();
        for a in b'a'..=b'z' {
            keys.push((a as char).to_string());
            for b in b'a'..=b'z' {
                keys.push(format!("{}{}", a as char, b as char));
            }
        }
        for a in &keys {
            for b in &keys {
                if a >= b {
                    continue;
                }
                match between(a, b) {
                    Ok(mid) => assert!(a < &mid && &mid < b, "{a} < {mid} < {b}"),
                    Err(SortError::Exhausted) => {
                        // For short keys the only exhausted shape is b == a + "a".
                        assert_eq!(b.as_str(), format!("{a}a"));
                    }
                    Err(e) => panic!("unexpected error {e:?} for ({a}, {b})"),
                }
            }
        }
    }

    #[test]
    fn spread_generates_ordered_valid_keys() {
        for count in [0, 1, 2, 25, 26, 27, 100, 1000] {
            let keys = spread(count);
            assert_eq!(keys.len(), count);
            assert!(keys.windows(2).all(|w| w[0] < w[1]), "count {count}");
            for key in &keys {
                validate(key).unwrap();
            }
        }
        assert!(spread(0).is_empty());
        assert_eq!(spread(1), ["t"]);
    }

    #[test]
    fn sequential_appends_grow_slowly_and_rebalance_reclaims_space() {
        let mut last = first();
        let mut keys = vec![last.clone()];
        for _ in 0..1000 {
            last = after(&last).unwrap();
            keys.push(last.clone());
        }
        assert!(keys.windows(2).all(|w| w[0] < w[1]));
        // Corner descent costs ~1 char per ~13 consecutive appends.
        let max_len = keys.iter().map(String::len).max().unwrap();
        assert!(max_len <= 100, "max key length {max_len}");
        // A single spread() rebalance restarts the list on short keys:
        // 26^3 > 1001, so the whole list fits in 3 characters again.
        let rebalanced = spread(keys.len());
        assert_eq!(rebalanced.len(), keys.len());
        assert!(rebalanced.iter().map(String::len).max().unwrap() <= 3);
    }

    /// Simulates manual reordering: 2000 pseudo-random insertions into random
    /// positions, rebalancing with `spread` whenever a slot is exhausted.
    #[test]
    fn random_insertions_keep_the_list_ordered() {
        let mut rng = Lcg(42);
        let mut keys = vec![first()];
        for _ in 0..2000 {
            let pos = (rng.next() as usize) % (keys.len() + 1);
            let result = match (pos.checked_sub(1), keys.get(pos)) {
                (None, Some(succ)) => before(succ),
                (None, None) => unreachable!("list is never empty"),
                (Some(p), None) => after(&keys[p]),
                (Some(p), Some(succ)) => between(&keys[p], succ),
            };
            match result {
                Ok(key) => keys.insert(pos, key),
                Err(SortError::Exhausted) => {
                    keys = spread(keys.len() + 1);
                }
                Err(e) => panic!("{e:?}"),
            }
            assert!(
                keys.windows(2).all(|w| w[0] < w[1]),
                "unordered after insert at {pos}"
            );
        }
        let max_len = keys.iter().map(String::len).max().unwrap();
        assert!(max_len <= 24, "max key length {max_len}");
    }

    #[test]
    fn sort_errors_convert_to_validation_app_errors() {
        assert_eq!(AppError::from(SortError::Exhausted).code(), "validation");
        assert_eq!(
            AppError::from(SortError::InvalidKey("zzz".into())).code(),
            "validation"
        );
        assert_eq!(AppError::from(SortError::InvalidOrder).code(), "validation");
    }
}
