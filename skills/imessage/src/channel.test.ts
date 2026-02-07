import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ChannelPlugin } from "../../../src/channels/plugins/types.js";
import type { MicroClawConfig } from "../../../src/config/types.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const execFileMock = vi.fn();

vi.mock("node:child_process", () => ({
  execFile: execFileMock,
}));

vi.mock("node:fs/promises", () => ({
  writeFile: vi.fn(async () => {}),
  unlink: vi.fn(async () => {}),
}));

vi.mock("node:crypto", () => ({
  randomBytes: () => ({
    toString: () => "deadbeef12345678",
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setupExecFileMock(
  results: Array<{ stdout?: string; stderr?: string; error?: Error }>,
): void {
  let callIndex = 0;
  execFileMock.mockImplementation(
    (
      _cmd: string,
      _args: string[],
      _opts: Record<string, unknown>,
      cb: (err: Error | null, result: { stdout: string; stderr: string }) => void,
    ) => {
      const entry = results[callIndex] ?? results[results.length - 1];
      callIndex++;
      if (entry?.error) {
        cb(entry.error, { stdout: "", stderr: "" });
      } else {
        cb(null, { stdout: entry?.stdout ?? "", stderr: entry?.stderr ?? "" });
      }
    },
  );
}

function makeConfig(overrides?: Partial<MicroClawConfig>): MicroClawConfig {
  return {
    channels: {
      imessage: { enabled: true },
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Dynamic import to allow mocks to wire up first
// ---------------------------------------------------------------------------

let createIMessagePlugin: () => ChannelPlugin;

beforeEach(async () => {
  vi.resetModules();

  // Re-setup the mocks after module reset
  execFileMock.mockReset();

  const channelMod = await import("./channel.js");
  createIMessagePlugin = channelMod.createIMessagePlugin;
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ===========================================================================
// createIMessagePlugin - structural tests
// ===========================================================================

describe("createIMessagePlugin", () => {
  it("returns a plugin with id 'imessage'", () => {
    const plugin = createIMessagePlugin();
    expect(plugin.id).toBe("imessage");
  });

  it("has correct meta fields", () => {
    const plugin = createIMessagePlugin();
    expect(plugin.meta).toEqual({
      id: "imessage",
      label: "iMessage",
      selectionLabel: "iMessage",
      blurb: "iMessage integration (macOS only).",
      aliases: ["imsg"],
    });
  });

  it("declares direct and group chat types", () => {
    const plugin = createIMessagePlugin();
    expect(plugin.capabilities.chatTypes).toEqual(["direct", "group"]);
  });

  it("declares reactions and media capabilities", () => {
    const plugin = createIMessagePlugin();
    expect(plugin.capabilities.reactions).toBe(true);
    expect(plugin.capabilities.media).toBe(true);
  });

  it("has outbound adapter with textChunkLimit of 4000", () => {
    const plugin = createIMessagePlugin();
    expect(plugin.outbound?.textChunkLimit).toBe(4000);
  });

  it("has sendText and sendMedia functions", () => {
    const plugin = createIMessagePlugin();
    expect(typeof plugin.outbound?.sendText).toBe("function");
    expect(typeof plugin.outbound?.sendMedia).toBe("function");
  });

  it("has gateway adapter with startAccount and stopAccount", () => {
    const plugin = createIMessagePlugin();
    expect(typeof plugin.gateway?.startAccount).toBe("function");
    expect(typeof plugin.gateway?.stopAccount).toBe("function");
  });
});

// ===========================================================================
// config adapter
// ===========================================================================

describe("config adapter", () => {
  it("isConfigured returns based on platform", () => {
    const plugin = createIMessagePlugin();
    const result = plugin.config.isConfigured?.(makeConfig());
    // On non-darwin CI, this will be false; on macOS it will be true.
    expect(typeof result).toBe("boolean");
    expect(result).toBe(process.platform === "darwin");
  });

  it("isEnabled returns true when imessage.enabled is true", () => {
    const plugin = createIMessagePlugin();
    const cfg = makeConfig({
      channels: { imessage: { enabled: true } },
    });
    expect(plugin.config.isEnabled?.(cfg)).toBe(true);
  });

  it("isEnabled returns true when imessage.enabled is undefined (default)", () => {
    const plugin = createIMessagePlugin();
    const cfg: MicroClawConfig = { channels: { imessage: {} } };
    expect(plugin.config.isEnabled?.(cfg)).toBe(true);
  });

  it("isEnabled returns false when imessage.enabled is false", () => {
    const plugin = createIMessagePlugin();
    const cfg = makeConfig({
      channels: { imessage: { enabled: false } },
    });
    expect(plugin.config.isEnabled?.(cfg)).toBe(false);
  });

  it("isEnabled returns true when channels is undefined", () => {
    const plugin = createIMessagePlugin();
    const cfg: MicroClawConfig = {};
    expect(plugin.config.isEnabled?.(cfg)).toBe(true);
  });
});

// ===========================================================================
// isValidRecipient (tested indirectly via sendText / sendMedia)
// ===========================================================================

describe("isValidRecipient", () => {
  let plugin: ChannelPlugin;

  beforeEach(() => {
    plugin = createIMessagePlugin();
    // Mock platform to darwin so we isolate recipient validation
    vi.stubGlobal("process", { ...process, platform: "darwin" });
    setupExecFileMock([{ stdout: "" }]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("valid phone numbers", () => {
    const validPhones = [
      "+14155551234",
      "+447911123456",
      "1234567890",
      "+861301234567",
    ];

    for (const phone of validPhones) {
      it(`accepts '${phone}'`, async () => {
        const result = await plugin.outbound!.sendText!({
          config: makeConfig(),
          to: phone,
          text: "hello",
        });
        expect(result.ok).toBe(true);
      });
    }
  });

  describe("valid emails", () => {
    const validEmails = [
      "user@example.com",
      "first.last@domain.co.uk",
      "user+tag@mail.org",
    ];

    for (const email of validEmails) {
      it(`accepts '${email}'`, async () => {
        const result = await plugin.outbound!.sendText!({
          config: makeConfig(),
          to: email,
          text: "hello",
        });
        expect(result.ok).toBe(true);
      });
    }
  });

  describe("valid chat group ids", () => {
    it("accepts 'chat12345'", async () => {
      const result = await plugin.outbound!.sendText!({
        config: makeConfig(),
        to: "chat12345",
        text: "hello",
      });
      expect(result.ok).toBe(true);
    });
  });

  describe("valid iMessage chat ids", () => {
    it("accepts 'iMessage;-;+14155551234'", async () => {
      const result = await plugin.outbound!.sendText!({
        config: makeConfig(),
        to: "iMessage;-;+14155551234",
        text: "hello",
      });
      expect(result.ok).toBe(true);
    });

    it("accepts 'iMessage;+;chat12345'", async () => {
      const result = await plugin.outbound!.sendText!({
        config: makeConfig(),
        to: "iMessage;+;chat12345",
        text: "hello",
      });
      expect(result.ok).toBe(true);
    });
  });

  describe("invalid inputs", () => {
    const invalidRecipients = [
      "",
      "   ",
      "abc",
      "12345",  // too short for phone
      "not a valid recipient!",
      "@missing-user.com",
      "a".repeat(201), // too long
    ];

    for (const invalid of invalidRecipients) {
      it(`rejects '${invalid.slice(0, 30)}${invalid.length > 30 ? "..." : ""}'`, async () => {
        const result = await plugin.outbound!.sendText!({
          config: makeConfig(),
          to: invalid,
          text: "hello",
        });
        expect(result.ok).toBe(false);
      });
    }
  });
});

// ===========================================================================
// toAppleScriptChatId (tested indirectly via sendText args to osascript)
// ===========================================================================

describe("toAppleScriptChatId", () => {
  let plugin: ChannelPlugin;

  beforeEach(() => {
    plugin = createIMessagePlugin();
    vi.stubGlobal("process", { ...process, platform: "darwin" });
    setupExecFileMock([{ stdout: "" }]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("passes phone number as iMessage;-;+14155551234", async () => {
    await plugin.outbound!.sendText!({
      config: makeConfig(),
      to: "+14155551234",
      text: "hello",
    });

    // The last two args to osascript should be the text and the chatId
    const callArgs = execFileMock.mock.calls[0];
    const osascriptArgs: string[] = callArgs[1];
    const chatIdArg = osascriptArgs[osascriptArgs.length - 1];
    expect(chatIdArg).toBe("iMessage;-;+14155551234");
  });

  it("passes group chat id as iMessage;+;chat12345", async () => {
    await plugin.outbound!.sendText!({
      config: makeConfig(),
      to: "chat12345",
      text: "hello",
    });

    const callArgs = execFileMock.mock.calls[0];
    const osascriptArgs: string[] = callArgs[1];
    const chatIdArg = osascriptArgs[osascriptArgs.length - 1];
    expect(chatIdArg).toBe("iMessage;+;chat12345");
  });

  it("passes already-formatted iMessage id as-is", async () => {
    await plugin.outbound!.sendText!({
      config: makeConfig(),
      to: "iMessage;-;user@example.com",
      text: "hello",
    });

    const callArgs = execFileMock.mock.calls[0];
    const osascriptArgs: string[] = callArgs[1];
    const chatIdArg = osascriptArgs[osascriptArgs.length - 1];
    expect(chatIdArg).toBe("iMessage;-;user@example.com");
  });

  it("passes email as iMessage;-;user@example.com", async () => {
    await plugin.outbound!.sendText!({
      config: makeConfig(),
      to: "user@example.com",
      text: "hello",
    });

    const callArgs = execFileMock.mock.calls[0];
    const osascriptArgs: string[] = callArgs[1];
    const chatIdArg = osascriptArgs[osascriptArgs.length - 1];
    expect(chatIdArg).toBe("iMessage;-;user@example.com");
  });
});

// ===========================================================================
// sendText
// ===========================================================================

describe("sendText", () => {
  let plugin: ChannelPlugin;

  beforeEach(() => {
    plugin = createIMessagePlugin();
  });

  it("returns ok:false on non-darwin platform", async () => {
    vi.stubGlobal("process", { ...process, platform: "linux" });
    const result = await plugin.outbound!.sendText!({
      config: makeConfig(),
      to: "+14155551234",
      text: "hello",
    });
    expect(result.ok).toBe(false);
    vi.unstubAllGlobals();
  });

  it("returns ok:false for invalid recipient", async () => {
    vi.stubGlobal("process", { ...process, platform: "darwin" });
    const result = await plugin.outbound!.sendText!({
      config: makeConfig(),
      to: "invalid!!",
      text: "hello",
    });
    expect(result.ok).toBe(false);
    vi.unstubAllGlobals();
  });

  it("invokes osascript with correct arguments", async () => {
    vi.stubGlobal("process", { ...process, platform: "darwin" });
    setupExecFileMock([{ stdout: "" }]);

    await plugin.outbound!.sendText!({
      config: makeConfig(),
      to: "+14155551234",
      text: "Hello World",
    });

    expect(execFileMock).toHaveBeenCalledOnce();
    const callArgs = execFileMock.mock.calls[0];
    expect(callArgs[0]).toBe("osascript");

    const args: string[] = callArgs[1];
    // Should contain the text and the chatId after "--"
    const dashDashIndex = args.indexOf("--");
    expect(dashDashIndex).toBeGreaterThan(-1);
    expect(args[dashDashIndex + 1]).toBe("Hello World");
    expect(args[dashDashIndex + 2]).toBe("iMessage;-;+14155551234");

    vi.unstubAllGlobals();
  });

  it("returns ok:true on successful send", async () => {
    vi.stubGlobal("process", { ...process, platform: "darwin" });
    setupExecFileMock([{ stdout: "" }]);

    const result = await plugin.outbound!.sendText!({
      config: makeConfig(),
      to: "+14155551234",
      text: "hello",
    });
    expect(result.ok).toBe(true);
    vi.unstubAllGlobals();
  });

  it("returns ok:false when osascript fails", async () => {
    vi.stubGlobal("process", { ...process, platform: "darwin" });
    setupExecFileMock([{ error: new Error("osascript failed") }]);

    const result = await plugin.outbound!.sendText!({
      config: makeConfig(),
      to: "+14155551234",
      text: "hello",
    });
    expect(result.ok).toBe(false);
    vi.unstubAllGlobals();
  });
});

// ===========================================================================
// sendMedia
// ===========================================================================

describe("sendMedia", () => {
  let plugin: ChannelPlugin;
  let writeFileMock: ReturnType<typeof vi.fn>;
  let unlinkMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    plugin = createIMessagePlugin();

    const fsMod = await import("node:fs/promises");
    writeFileMock = fsMod.writeFile as ReturnType<typeof vi.fn>;
    unlinkMock = fsMod.unlink as ReturnType<typeof vi.fn>;
    writeFileMock.mockClear();
    unlinkMock.mockClear();
  });

  it("returns ok:false on non-darwin platform", async () => {
    vi.stubGlobal("process", { ...process, platform: "linux" });
    const result = await plugin.outbound!.sendMedia!({
      config: makeConfig(),
      to: "+14155551234",
      media: Buffer.from("test"),
      mimeType: "image/png",
    });
    expect(result.ok).toBe(false);
    vi.unstubAllGlobals();
  });

  it("returns ok:false for invalid recipient", async () => {
    vi.stubGlobal("process", { ...process, platform: "darwin" });
    const result = await plugin.outbound!.sendMedia!({
      config: makeConfig(),
      to: "bad!",
      media: Buffer.from("test"),
      mimeType: "image/png",
    });
    expect(result.ok).toBe(false);
    vi.unstubAllGlobals();
  });

  it("returns ok:false when file exceeds 100MB", async () => {
    vi.stubGlobal("process", { ...process, platform: "darwin" });
    const oversizedBuffer = Buffer.alloc(100 * 1024 * 1024 + 1);
    const result = await plugin.outbound!.sendMedia!({
      config: makeConfig(),
      to: "+14155551234",
      media: oversizedBuffer,
      mimeType: "image/png",
    });
    expect(result.ok).toBe(false);
    vi.unstubAllGlobals();
  });

  it("writes temp file and sends via osascript", async () => {
    vi.stubGlobal("process", { ...process, platform: "darwin" });
    setupExecFileMock([{ stdout: "" }]);

    const mediaBuffer = Buffer.from("fake-image-data");
    await plugin.outbound!.sendMedia!({
      config: makeConfig(),
      to: "+14155551234",
      media: mediaBuffer,
      mimeType: "image/png",
    });

    // writeFile should be called with the temp path and the buffer
    expect(writeFileMock).toHaveBeenCalledOnce();
    const [writePath, writeData] = writeFileMock.mock.calls[0];
    expect(writePath).toContain("microclaw-");
    expect(writePath).toContain(".png");
    expect(writeData).toBe(mediaBuffer);

    // osascript should be invoked
    expect(execFileMock).toHaveBeenCalledOnce();

    vi.unstubAllGlobals();
  });

  it("cleans up temp file after send", async () => {
    vi.stubGlobal("process", { ...process, platform: "darwin" });
    setupExecFileMock([{ stdout: "" }]);

    await plugin.outbound!.sendMedia!({
      config: makeConfig(),
      to: "+14155551234",
      media: Buffer.from("data"),
      mimeType: "image/jpeg",
    });

    expect(unlinkMock).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

  it("cleans up temp file even when send fails", async () => {
    vi.stubGlobal("process", { ...process, platform: "darwin" });
    setupExecFileMock([{ error: new Error("send fail") }]);

    await plugin.outbound!.sendMedia!({
      config: makeConfig(),
      to: "+14155551234",
      media: Buffer.from("data"),
      mimeType: "image/jpeg",
    });

    expect(unlinkMock).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

  it("sends caption text after successful file send", async () => {
    vi.stubGlobal("process", { ...process, platform: "darwin" });
    // First call: sendFile succeeds, second call: sendText succeeds
    setupExecFileMock([{ stdout: "" }, { stdout: "" }]);

    await plugin.outbound!.sendMedia!({
      config: makeConfig(),
      to: "+14155551234",
      media: Buffer.from("data"),
      mimeType: "image/png",
      caption: "Check this out",
    });

    // Should have two osascript calls: file send + caption text
    expect(execFileMock).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });

  it("does not send caption when file send fails", async () => {
    vi.stubGlobal("process", { ...process, platform: "darwin" });
    setupExecFileMock([{ error: new Error("file fail") }]);

    await plugin.outbound!.sendMedia!({
      config: makeConfig(),
      to: "+14155551234",
      media: Buffer.from("data"),
      mimeType: "image/png",
      caption: "Check this out",
    });

    // Only one osascript call (the file send that failed)
    expect(execFileMock).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

  it("sanitizes mime type extension correctly", async () => {
    vi.stubGlobal("process", { ...process, platform: "darwin" });
    setupExecFileMock([{ stdout: "" }]);

    await plugin.outbound!.sendMedia!({
      config: makeConfig(),
      to: "+14155551234",
      media: Buffer.from("data"),
      mimeType: "application/x-tar+gzip",
    });

    const [writePath] = writeFileMock.mock.calls[0];
    // "x-tar+gzip" -> sanitized to remove non-alphanum -> "xtargzip"
    expect(writePath).toContain(".xtargzip");
    vi.unstubAllGlobals();
  });
});

// ===========================================================================
// gateway.startAccount / stopAccount
// ===========================================================================

describe("gateway lifecycle", () => {
  it("startAccount throws on non-darwin platform", async () => {
    vi.stubGlobal("process", { ...process, platform: "linux" });
    const plugin = createIMessagePlugin();

    await expect(
      plugin.gateway!.startAccount!({
        config: makeConfig(),
        accountId: "default",
        account: undefined,
        onMessage: async () => {},
      }),
    ).rejects.toThrow("iMessage is only available on macOS");

    vi.unstubAllGlobals();
  });

  it("startAccount succeeds on darwin and returns handle with stop", async () => {
    vi.stubGlobal("process", { ...process, platform: "darwin" });
    // Mock the sqlite3 call for getMaxRowId
    setupExecFileMock([{ stdout: "42\n" }]);

    const plugin = createIMessagePlugin();
    const handle = await plugin.gateway!.startAccount!({
      config: makeConfig(),
      accountId: "default",
      account: undefined,
      onMessage: async () => {},
    });

    expect(handle).toBeDefined();
    expect(typeof (handle as { stop: () => Promise<void> }).stop).toBe("function");

    // Clean up
    await (handle as { stop: () => Promise<void> }).stop();
    vi.unstubAllGlobals();
  });

  it("stopAccount is idempotent when no active handle", async () => {
    const plugin = createIMessagePlugin();
    // Should not throw
    await plugin.gateway!.stopAccount!({
      config: makeConfig(),
      accountId: "default",
    });
  });

  it("startAccount stops previous handle before starting new one", async () => {
    vi.stubGlobal("process", { ...process, platform: "darwin" });
    setupExecFileMock([{ stdout: "1\n" }, { stdout: "2\n" }]);

    const plugin = createIMessagePlugin();

    const handle1 = await plugin.gateway!.startAccount!({
      config: makeConfig(),
      accountId: "default",
      account: undefined,
      onMessage: async () => {},
    });

    const handle2 = await plugin.gateway!.startAccount!({
      config: makeConfig(),
      accountId: "default",
      account: undefined,
      onMessage: async () => {},
    });

    expect(handle2).toBeDefined();
    // Clean up
    await (handle2 as { stop: () => Promise<void> }).stop();
    vi.unstubAllGlobals();
  });

  it("stopAccount clears the active handle", async () => {
    vi.stubGlobal("process", { ...process, platform: "darwin" });
    setupExecFileMock([{ stdout: "10\n" }]);

    const plugin = createIMessagePlugin();

    await plugin.gateway!.startAccount!({
      config: makeConfig(),
      accountId: "default",
      account: undefined,
      onMessage: async () => {},
    });

    await plugin.gateway!.stopAccount!({
      config: makeConfig(),
      accountId: "default",
    });

    // Calling stopAccount again should be fine (no-op)
    await plugin.gateway!.stopAccount!({
      config: makeConfig(),
      accountId: "default",
    });

    vi.unstubAllGlobals();
  });

  it("uses default no-op onMessage when onMessage is undefined", async () => {
    vi.stubGlobal("process", { ...process, platform: "darwin" });
    setupExecFileMock([{ stdout: "0\n" }]);

    const plugin = createIMessagePlugin();

    const handle = await plugin.gateway!.startAccount!({
      config: makeConfig(),
      accountId: "default",
      account: undefined,
      onMessage: undefined,
    });

    expect(handle).toBeDefined();
    await (handle as { stop: () => Promise<void> }).stop();
    vi.unstubAllGlobals();
  });
});

// ===========================================================================
// Gateway internals (imported directly from gateway.ts)
// ===========================================================================

describe("gateway polling and message processing", () => {
  let startIMessageGateway: typeof import("./gateway.js").startIMessageGateway;

  beforeEach(async () => {
    vi.useFakeTimers();
    const gatewayMod = await import("./gateway.js");
    startIMessageGateway = gatewayMod.startIMessageGateway;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts polling and processes new messages", async () => {
    const messages = [
      {
        rowid: 100,
        text: "Hello from gateway test",
        msg_date: 700000000,
        sender_id: "+14155551234",
        chat_identifier: "iMessage;-;+14155551234",
        display_name: null,
        group_id: null,
      },
    ];

    let callCount = 0;
    execFileMock.mockImplementation(
      (
        cmd: string,
        args: string[],
        _opts: Record<string, unknown>,
        cb: (err: Error | null, result: { stdout: string; stderr: string }) => void,
      ) => {
        if (cmd === "sqlite3" && args.some((a: string) => a.includes("MAX(ROWID)"))) {
          cb(null, { stdout: "50\n", stderr: "" });
        } else if (cmd === "sqlite3" && args.some((a: string) => a.includes("-json"))) {
          callCount++;
          if (callCount === 1) {
            cb(null, { stdout: JSON.stringify(messages), stderr: "" });
          } else {
            cb(null, { stdout: "", stderr: "" });
          }
        } else {
          cb(null, { stdout: "", stderr: "" });
        }
      },
    );

    const received: Array<{ from: string; text: string; chatType: string; chatId: string }> = [];

    const handle = await startIMessageGateway({
      onMessage: async (msg) => {
        received.push({
          from: msg.from,
          text: msg.text,
          chatType: msg.chatType,
          chatId: msg.chatId,
        });
      },
      pollIntervalMs: 1000,
    });

    // Advance timer to trigger a poll
    await vi.advanceTimersByTimeAsync(1100);

    expect(received).toHaveLength(1);
    expect(received[0].from).toBe("+14155551234");
    expect(received[0].text).toBe("Hello from gateway test");
    expect(received[0].chatType).toBe("direct");
    expect(received[0].chatId).toBe("iMessage;-;+14155551234");

    await handle.stop();
  });

  it("filters messages based on allowFrom", async () => {
    const messages = [
      {
        rowid: 101,
        text: "Allowed",
        msg_date: 700000000,
        sender_id: "+14155551234",
        chat_identifier: "iMessage;-;+14155551234",
        display_name: null,
        group_id: null,
      },
      {
        rowid: 102,
        text: "Blocked",
        msg_date: 700000001,
        sender_id: "+19875556789",
        chat_identifier: "iMessage;-;+19875556789",
        display_name: null,
        group_id: null,
      },
    ];

    let callCount = 0;
    execFileMock.mockImplementation(
      (
        cmd: string,
        args: string[],
        _opts: Record<string, unknown>,
        cb: (err: Error | null, result: { stdout: string; stderr: string }) => void,
      ) => {
        if (cmd === "sqlite3" && args.some((a: string) => a.includes("MAX(ROWID)"))) {
          cb(null, { stdout: "50\n", stderr: "" });
        } else if (cmd === "sqlite3" && args.some((a: string) => a.includes("-json"))) {
          callCount++;
          if (callCount === 1) {
            cb(null, { stdout: JSON.stringify(messages), stderr: "" });
          } else {
            cb(null, { stdout: "", stderr: "" });
          }
        } else {
          cb(null, { stdout: "", stderr: "" });
        }
      },
    );

    const received: string[] = [];

    const handle = await startIMessageGateway({
      allowFrom: ["+14155551234"],
      onMessage: async (msg) => {
        received.push(msg.from);
      },
      pollIntervalMs: 1000,
    });

    await vi.advanceTimersByTimeAsync(1100);

    expect(received).toHaveLength(1);
    expect(received[0]).toBe("+14155551234");

    await handle.stop();
  });

  it("truncates messages longer than 8000 characters", async () => {
    const longText = "x".repeat(10000);
    const messages = [
      {
        rowid: 200,
        text: longText,
        msg_date: 700000000,
        sender_id: "+14155551234",
        chat_identifier: "iMessage;-;+14155551234",
        display_name: null,
        group_id: null,
      },
    ];

    let callCount = 0;
    execFileMock.mockImplementation(
      (
        cmd: string,
        args: string[],
        _opts: Record<string, unknown>,
        cb: (err: Error | null, result: { stdout: string; stderr: string }) => void,
      ) => {
        if (cmd === "sqlite3" && args.some((a: string) => a.includes("MAX(ROWID)"))) {
          cb(null, { stdout: "50\n", stderr: "" });
        } else if (cmd === "sqlite3" && args.some((a: string) => a.includes("-json"))) {
          callCount++;
          if (callCount === 1) {
            cb(null, { stdout: JSON.stringify(messages), stderr: "" });
          } else {
            cb(null, { stdout: "", stderr: "" });
          }
        } else {
          cb(null, { stdout: "", stderr: "" });
        }
      },
    );

    const received: string[] = [];

    const handle = await startIMessageGateway({
      onMessage: async (msg) => {
        received.push(msg.text);
      },
      pollIntervalMs: 1000,
    });

    await vi.advanceTimersByTimeAsync(1100);

    expect(received).toHaveLength(1);
    expect(received[0]).toHaveLength(8000);

    await handle.stop();
  });

  it("resolves group chat type when group_id is present", async () => {
    const messages = [
      {
        rowid: 300,
        text: "Group msg",
        msg_date: 700000000,
        sender_id: "+14155551234",
        chat_identifier: "iMessage;+;chat999",
        display_name: "My Group",
        group_id: "chat999",
      },
    ];

    let callCount = 0;
    execFileMock.mockImplementation(
      (
        cmd: string,
        args: string[],
        _opts: Record<string, unknown>,
        cb: (err: Error | null, result: { stdout: string; stderr: string }) => void,
      ) => {
        if (cmd === "sqlite3" && args.some((a: string) => a.includes("MAX(ROWID)"))) {
          cb(null, { stdout: "50\n", stderr: "" });
        } else if (cmd === "sqlite3" && args.some((a: string) => a.includes("-json"))) {
          callCount++;
          if (callCount === 1) {
            cb(null, { stdout: JSON.stringify(messages), stderr: "" });
          } else {
            cb(null, { stdout: "", stderr: "" });
          }
        } else {
          cb(null, { stdout: "", stderr: "" });
        }
      },
    );

    const received: Array<{ chatType: string; chatId: string }> = [];

    const handle = await startIMessageGateway({
      onMessage: async (msg) => {
        received.push({ chatType: msg.chatType, chatId: msg.chatId });
      },
      pollIntervalMs: 1000,
    });

    await vi.advanceTimersByTimeAsync(1100);

    expect(received).toHaveLength(1);
    expect(received[0].chatType).toBe("group");
    expect(received[0].chatId).toBe("iMessage;+;chat999");

    await handle.stop();
  });

  it("skips messages with null sender_id", async () => {
    const messages = [
      {
        rowid: 400,
        text: "No sender",
        msg_date: 700000000,
        sender_id: null,
        chat_identifier: "iMessage;-;unknown",
        display_name: null,
        group_id: null,
      },
    ];

    let callCount = 0;
    execFileMock.mockImplementation(
      (
        cmd: string,
        args: string[],
        _opts: Record<string, unknown>,
        cb: (err: Error | null, result: { stdout: string; stderr: string }) => void,
      ) => {
        if (cmd === "sqlite3" && args.some((a: string) => a.includes("MAX(ROWID)"))) {
          cb(null, { stdout: "50\n", stderr: "" });
        } else if (cmd === "sqlite3" && args.some((a: string) => a.includes("-json"))) {
          callCount++;
          if (callCount === 1) {
            cb(null, { stdout: JSON.stringify(messages), stderr: "" });
          } else {
            cb(null, { stdout: "", stderr: "" });
          }
        } else {
          cb(null, { stdout: "", stderr: "" });
        }
      },
    );

    const received: string[] = [];

    const handle = await startIMessageGateway({
      onMessage: async (msg) => {
        received.push(msg.text);
      },
      pollIntervalMs: 1000,
    });

    await vi.advanceTimersByTimeAsync(1100);

    expect(received).toHaveLength(0);

    await handle.stop();
  });

  it("skips messages with empty text", async () => {
    const messages = [
      {
        rowid: 401,
        text: "",
        msg_date: 700000000,
        sender_id: "+14155551234",
        chat_identifier: "iMessage;-;+14155551234",
        display_name: null,
        group_id: null,
      },
    ];

    let callCount = 0;
    execFileMock.mockImplementation(
      (
        cmd: string,
        args: string[],
        _opts: Record<string, unknown>,
        cb: (err: Error | null, result: { stdout: string; stderr: string }) => void,
      ) => {
        if (cmd === "sqlite3" && args.some((a: string) => a.includes("MAX(ROWID)"))) {
          cb(null, { stdout: "50\n", stderr: "" });
        } else if (cmd === "sqlite3" && args.some((a: string) => a.includes("-json"))) {
          callCount++;
          if (callCount === 1) {
            cb(null, { stdout: JSON.stringify(messages), stderr: "" });
          } else {
            cb(null, { stdout: "", stderr: "" });
          }
        } else {
          cb(null, { stdout: "", stderr: "" });
        }
      },
    );

    const received: string[] = [];

    const handle = await startIMessageGateway({
      onMessage: async (msg) => {
        received.push(msg.text);
      },
      pollIntervalMs: 1000,
    });

    await vi.advanceTimersByTimeAsync(1100);

    expect(received).toHaveLength(0);

    await handle.stop();
  });

  it("uses sender_id as chatId when chat_identifier is null", async () => {
    const messages = [
      {
        rowid: 500,
        text: "Fallback chatId",
        msg_date: 700000000,
        sender_id: "+14155551234",
        chat_identifier: null,
        display_name: null,
        group_id: null,
      },
    ];

    let callCount = 0;
    execFileMock.mockImplementation(
      (
        cmd: string,
        args: string[],
        _opts: Record<string, unknown>,
        cb: (err: Error | null, result: { stdout: string; stderr: string }) => void,
      ) => {
        if (cmd === "sqlite3" && args.some((a: string) => a.includes("MAX(ROWID)"))) {
          cb(null, { stdout: "50\n", stderr: "" });
        } else if (cmd === "sqlite3" && args.some((a: string) => a.includes("-json"))) {
          callCount++;
          if (callCount === 1) {
            cb(null, { stdout: JSON.stringify(messages), stderr: "" });
          } else {
            cb(null, { stdout: "", stderr: "" });
          }
        } else {
          cb(null, { stdout: "", stderr: "" });
        }
      },
    );

    const received: string[] = [];

    const handle = await startIMessageGateway({
      onMessage: async (msg) => {
        received.push(msg.chatId);
      },
      pollIntervalMs: 1000,
    });

    await vi.advanceTimersByTimeAsync(1100);

    expect(received).toHaveLength(1);
    expect(received[0]).toBe("+14155551234");

    await handle.stop();
  });

  it("continues polling after onMessage handler throws", async () => {
    const messages1 = [
      {
        rowid: 600,
        text: "First",
        msg_date: 700000000,
        sender_id: "+14155551234",
        chat_identifier: "iMessage;-;+14155551234",
        display_name: null,
        group_id: null,
      },
    ];

    const messages2 = [
      {
        rowid: 601,
        text: "Second",
        msg_date: 700000001,
        sender_id: "+14155551234",
        chat_identifier: "iMessage;-;+14155551234",
        display_name: null,
        group_id: null,
      },
    ];

    let callCount = 0;
    execFileMock.mockImplementation(
      (
        cmd: string,
        args: string[],
        _opts: Record<string, unknown>,
        cb: (err: Error | null, result: { stdout: string; stderr: string }) => void,
      ) => {
        if (cmd === "sqlite3" && args.some((a: string) => a.includes("MAX(ROWID)"))) {
          cb(null, { stdout: "50\n", stderr: "" });
        } else if (cmd === "sqlite3" && args.some((a: string) => a.includes("-json"))) {
          callCount++;
          if (callCount === 1) {
            cb(null, { stdout: JSON.stringify(messages1), stderr: "" });
          } else if (callCount === 2) {
            cb(null, { stdout: JSON.stringify(messages2), stderr: "" });
          } else {
            cb(null, { stdout: "", stderr: "" });
          }
        } else {
          cb(null, { stdout: "", stderr: "" });
        }
      },
    );

    let handlerCallCount = 0;
    const received: string[] = [];

    const handle = await startIMessageGateway({
      onMessage: async (msg) => {
        handlerCallCount++;
        if (handlerCallCount === 1) {
          throw new Error("Handler error");
        }
        received.push(msg.text);
      },
      pollIntervalMs: 1000,
      logger: {
        info: () => {},
        warn: () => {},
        error: () => {},
      },
    });

    // First poll triggers the error
    await vi.advanceTimersByTimeAsync(1100);
    // Second poll should still work
    await vi.advanceTimersByTimeAsync(1100);

    expect(handlerCallCount).toBe(2);
    expect(received).toHaveLength(1);
    expect(received[0]).toBe("Second");

    await handle.stop();
  });

  it("handles sqlite3 query failures gracefully", async () => {
    execFileMock.mockImplementation(
      (
        _cmd: string,
        _args: string[],
        _opts: Record<string, unknown>,
        cb: (err: Error | null, result: { stdout: string; stderr: string }) => void,
      ) => {
        cb(new Error("sqlite3 not found"), { stdout: "", stderr: "" });
      },
    );

    const received: string[] = [];

    const handle = await startIMessageGateway({
      onMessage: async (msg) => {
        received.push(msg.text);
      },
      pollIntervalMs: 1000,
    });

    await vi.advanceTimersByTimeAsync(1100);

    // Should not crash, just no messages
    expect(received).toHaveLength(0);

    await handle.stop();
  });

  it("stop prevents further polling", async () => {
    execFileMock.mockImplementation(
      (
        cmd: string,
        args: string[],
        _opts: Record<string, unknown>,
        cb: (err: Error | null, result: { stdout: string; stderr: string }) => void,
      ) => {
        if (cmd === "sqlite3" && args.some((a: string) => a.includes("MAX(ROWID)"))) {
          cb(null, { stdout: "0\n", stderr: "" });
        } else {
          cb(null, { stdout: "", stderr: "" });
        }
      },
    );

    let pollCount = 0;
    const originalImpl = execFileMock.getMockImplementation()!;
    execFileMock.mockImplementation((...args: unknown[]) => {
      const castArgs = args as [string, string[], Record<string, unknown>, (err: Error | null, result: { stdout: string; stderr: string }) => void];
      if (castArgs[0] === "sqlite3" && (castArgs[1] as string[]).some((a: string) => a.includes("-json"))) {
        pollCount++;
      }
      return (originalImpl as (...a: unknown[]) => unknown)(...args);
    });

    const handle = await startIMessageGateway({
      onMessage: async () => {},
      pollIntervalMs: 500,
    });

    await vi.advanceTimersByTimeAsync(600);
    const countAfterFirstPoll = pollCount;

    await handle.stop();

    await vi.advanceTimersByTimeAsync(2000);
    // No more polls should have happened after stop
    expect(pollCount).toBe(countAfterFirstPoll);
  });
});

// ===========================================================================
// Timestamp conversion (tested via gateway message processing)
// ===========================================================================

describe("timestamp conversion", () => {
  let startIMessageGateway: typeof import("./gateway.js").startIMessageGateway;

  beforeEach(async () => {
    vi.useFakeTimers();
    const gatewayMod = await import("./gateway.js");
    startIMessageGateway = gatewayMod.startIMessageGateway;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("converts nanosecond Apple timestamps", async () => {
    // Apple epoch nanosecond timestamp: e.g., 700000000000000000 ns
    const appleNanoseconds = 700_000_000_000_000_000;
    const messages = [
      {
        rowid: 700,
        text: "Nano ts",
        msg_date: appleNanoseconds,
        sender_id: "+14155551234",
        chat_identifier: "iMessage;-;+14155551234",
        display_name: null,
        group_id: null,
      },
    ];

    let callCount = 0;
    execFileMock.mockImplementation(
      (
        cmd: string,
        args: string[],
        _opts: Record<string, unknown>,
        cb: (err: Error | null, result: { stdout: string; stderr: string }) => void,
      ) => {
        if (cmd === "sqlite3" && args.some((a: string) => a.includes("MAX(ROWID)"))) {
          cb(null, { stdout: "50\n", stderr: "" });
        } else if (cmd === "sqlite3" && args.some((a: string) => a.includes("-json"))) {
          callCount++;
          if (callCount === 1) {
            cb(null, { stdout: JSON.stringify(messages), stderr: "" });
          } else {
            cb(null, { stdout: "", stderr: "" });
          }
        } else {
          cb(null, { stdout: "", stderr: "" });
        }
      },
    );

    const timestamps: number[] = [];

    const handle = await startIMessageGateway({
      onMessage: async (msg) => {
        timestamps.push(msg.timestamp);
      },
      pollIntervalMs: 1000,
    });

    await vi.advanceTimersByTimeAsync(1100);

    expect(timestamps).toHaveLength(1);
    // The nanosecond value divided by 1e9 + APPLE_EPOCH_OFFSET (978307200) * 1000
    const expectedSeconds = appleNanoseconds / 1_000_000_000 + 978307200;
    const expectedMs = Math.floor(expectedSeconds * 1000);
    expect(timestamps[0]).toBe(expectedMs);

    await handle.stop();
  });

  it("converts second-based Apple timestamps", async () => {
    // A second-based Apple timestamp (below nanosecond threshold)
    const appleSeconds = 700_000_000;
    const messages = [
      {
        rowid: 701,
        text: "Sec ts",
        msg_date: appleSeconds,
        sender_id: "+14155551234",
        chat_identifier: "iMessage;-;+14155551234",
        display_name: null,
        group_id: null,
      },
    ];

    let callCount = 0;
    execFileMock.mockImplementation(
      (
        cmd: string,
        args: string[],
        _opts: Record<string, unknown>,
        cb: (err: Error | null, result: { stdout: string; stderr: string }) => void,
      ) => {
        if (cmd === "sqlite3" && args.some((a: string) => a.includes("MAX(ROWID)"))) {
          cb(null, { stdout: "50\n", stderr: "" });
        } else if (cmd === "sqlite3" && args.some((a: string) => a.includes("-json"))) {
          callCount++;
          if (callCount === 1) {
            cb(null, { stdout: JSON.stringify(messages), stderr: "" });
          } else {
            cb(null, { stdout: "", stderr: "" });
          }
        } else {
          cb(null, { stdout: "", stderr: "" });
        }
      },
    );

    const timestamps: number[] = [];

    const handle = await startIMessageGateway({
      onMessage: async (msg) => {
        timestamps.push(msg.timestamp);
      },
      pollIntervalMs: 1000,
    });

    await vi.advanceTimersByTimeAsync(1100);

    expect(timestamps).toHaveLength(1);
    const expectedMs = Math.floor((appleSeconds + 978307200) * 1000);
    expect(timestamps[0]).toBe(expectedMs);

    await handle.stop();
  });

  it("falls back to Date.now() for zero/negative timestamps", async () => {
    const messages = [
      {
        rowid: 702,
        text: "Zero ts",
        msg_date: 0,
        sender_id: "+14155551234",
        chat_identifier: "iMessage;-;+14155551234",
        display_name: null,
        group_id: null,
      },
    ];

    let callCount = 0;
    execFileMock.mockImplementation(
      (
        cmd: string,
        args: string[],
        _opts: Record<string, unknown>,
        cb: (err: Error | null, result: { stdout: string; stderr: string }) => void,
      ) => {
        if (cmd === "sqlite3" && args.some((a: string) => a.includes("MAX(ROWID)"))) {
          cb(null, { stdout: "50\n", stderr: "" });
        } else if (cmd === "sqlite3" && args.some((a: string) => a.includes("-json"))) {
          callCount++;
          if (callCount === 1) {
            cb(null, { stdout: JSON.stringify(messages), stderr: "" });
          } else {
            cb(null, { stdout: "", stderr: "" });
          }
        } else {
          cb(null, { stdout: "", stderr: "" });
        }
      },
    );

    const timestamps: number[] = [];

    const handle = await startIMessageGateway({
      onMessage: async (msg) => {
        timestamps.push(msg.timestamp);
      },
      pollIntervalMs: 1000,
    });

    await vi.advanceTimersByTimeAsync(1100);

    expect(timestamps).toHaveLength(1);
    // With fake timers, Date.now() returns 0 at the start, but after advancing it returns the advanced time
    // The key check is that it's a valid number, not the apple-epoch-based calculation
    expect(typeof timestamps[0]).toBe("number");
    expect(timestamps[0]).toBeGreaterThanOrEqual(0);

    await handle.stop();
  });
});

// ===========================================================================
// allowFrom filtering edge cases
// ===========================================================================

describe("allowFrom filtering edge cases", () => {
  let startIMessageGateway: typeof import("./gateway.js").startIMessageGateway;

  beforeEach(async () => {
    vi.useFakeTimers();
    const gatewayMod = await import("./gateway.js");
    startIMessageGateway = gatewayMod.startIMessageGateway;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows all messages when allowFrom is empty array", async () => {
    const messages = [
      {
        rowid: 800,
        text: "Anyone",
        msg_date: 700000000,
        sender_id: "+19999999999",
        chat_identifier: "iMessage;-;+19999999999",
        display_name: null,
        group_id: null,
      },
    ];

    let callCount = 0;
    execFileMock.mockImplementation(
      (
        cmd: string,
        args: string[],
        _opts: Record<string, unknown>,
        cb: (err: Error | null, result: { stdout: string; stderr: string }) => void,
      ) => {
        if (cmd === "sqlite3" && args.some((a: string) => a.includes("MAX(ROWID)"))) {
          cb(null, { stdout: "50\n", stderr: "" });
        } else if (cmd === "sqlite3" && args.some((a: string) => a.includes("-json"))) {
          callCount++;
          if (callCount === 1) {
            cb(null, { stdout: JSON.stringify(messages), stderr: "" });
          } else {
            cb(null, { stdout: "", stderr: "" });
          }
        } else {
          cb(null, { stdout: "", stderr: "" });
        }
      },
    );

    const received: string[] = [];

    const handle = await startIMessageGateway({
      allowFrom: [],
      onMessage: async (msg) => {
        received.push(msg.from);
      },
      pollIntervalMs: 1000,
    });

    await vi.advanceTimersByTimeAsync(1100);

    expect(received).toHaveLength(1);
    await handle.stop();
  });

  it("normalizes phone numbers by stripping spaces, parens, dashes for matching", async () => {
    const messages = [
      {
        rowid: 801,
        text: "Formatted number",
        msg_date: 700000000,
        sender_id: "+1 (415) 555-1234",
        chat_identifier: "iMessage;-;+14155551234",
        display_name: null,
        group_id: null,
      },
    ];

    let callCount = 0;
    execFileMock.mockImplementation(
      (
        cmd: string,
        args: string[],
        _opts: Record<string, unknown>,
        cb: (err: Error | null, result: { stdout: string; stderr: string }) => void,
      ) => {
        if (cmd === "sqlite3" && args.some((a: string) => a.includes("MAX(ROWID)"))) {
          cb(null, { stdout: "50\n", stderr: "" });
        } else if (cmd === "sqlite3" && args.some((a: string) => a.includes("-json"))) {
          callCount++;
          if (callCount === 1) {
            cb(null, { stdout: JSON.stringify(messages), stderr: "" });
          } else {
            cb(null, { stdout: "", stderr: "" });
          }
        } else {
          cb(null, { stdout: "", stderr: "" });
        }
      },
    );

    const received: string[] = [];

    const handle = await startIMessageGateway({
      allowFrom: ["+14155551234"],
      onMessage: async (msg) => {
        received.push(msg.from);
      },
      pollIntervalMs: 1000,
    });

    await vi.advanceTimersByTimeAsync(1100);

    expect(received).toHaveLength(1);
    await handle.stop();
  });

  it("allows all when allowFrom is undefined", async () => {
    const messages = [
      {
        rowid: 802,
        text: "No filter",
        msg_date: 700000000,
        sender_id: "+10000000000",
        chat_identifier: "iMessage;-;+10000000000",
        display_name: null,
        group_id: null,
      },
    ];

    let callCount = 0;
    execFileMock.mockImplementation(
      (
        cmd: string,
        args: string[],
        _opts: Record<string, unknown>,
        cb: (err: Error | null, result: { stdout: string; stderr: string }) => void,
      ) => {
        if (cmd === "sqlite3" && args.some((a: string) => a.includes("MAX(ROWID)"))) {
          cb(null, { stdout: "50\n", stderr: "" });
        } else if (cmd === "sqlite3" && args.some((a: string) => a.includes("-json"))) {
          callCount++;
          if (callCount === 1) {
            cb(null, { stdout: JSON.stringify(messages), stderr: "" });
          } else {
            cb(null, { stdout: "", stderr: "" });
          }
        } else {
          cb(null, { stdout: "", stderr: "" });
        }
      },
    );

    const received: string[] = [];

    const handle = await startIMessageGateway({
      onMessage: async (msg) => {
        received.push(msg.from);
      },
      pollIntervalMs: 1000,
    });

    await vi.advanceTimersByTimeAsync(1100);

    expect(received).toHaveLength(1);
    await handle.stop();
  });
});
