/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import "./setup";
import { Badge } from "../badge";

describe("Badge", () => {
  afterEach(cleanup);

  it("renders its content with the variant class", () => {
    render(() => <Badge variant="danger">高优先级</Badge>);

    expect(screen.getByText("高优先级")).toBeTruthy();
  });
});
