import { afterEach, describe, expect, it, vi } from "vitest";
import {
  correlatableRequestId,
  logRealtime,
} from "@/lib/realtime-diagnostics";

describe("realtime diagnostics", () => {
  afterEach(() => {
    window.history.replaceState({}, "", "/");
    vi.restoreAllMocks();
  });

  it("logs the safe correlation id only when realtime debugging is enabled", () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    window.history.replaceState({}, "", "/room/AB7K2?realtime-debug=1");

    logRealtime("client_command_sent", {
      requestId: "90f1e3d8-4817-4a2b-9b29-017d3f64f5a2",
      type: "ROLL_DICE",
    });

    expect(log).toHaveBeenCalledWith(
      "[parchis-realtime]",
      expect.any(String),
    );

    const serializedEntry = log.mock.calls[0]?.[1];
    expect(typeof serializedEntry).toBe("string");
    expect(JSON.parse(serializedEntry as string)).toMatchObject({
      event: "client_command_sent",
      requestId: "90f1e3d8-4817-4a2b-9b29-017d3f64f5a2",
      type: "ROLL_DICE",
    });
  });

  it("does not emit browser diagnostics unless explicitly enabled", () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);

    logRealtime("client_command_sent", { type: "ROLL_DICE" });

    expect(log).not.toHaveBeenCalled();
  });

  it("allows UUID request ids to correlate logs but ignores arbitrary client text", () => {
    expect(correlatableRequestId("90f1e3d8-4817-4a2b-9b29-017d3f64f5a2"))
      .toBe("90f1e3d8-4817-4a2b-9b29-017d3f64f5a2");
    expect(correlatableRequestId("private text\nwith newline")).toBeNull();
  });
});
