import { describe, expect, it } from "vitest";

import { History, MemoryHistoryStorage, partitionByHistory } from "@/lib/history";

function makeHistory(): { history: History; storage: MemoryHistoryStorage } {
  const storage = new MemoryHistoryStorage();
  const history = new History(storage);
  history.load();
  return { history, storage };
}

describe("History", () => {
  it("marca y recuerda las descargas correctas", () => {
    const { history } = makeHistory();

    history.mark("1", "ok", { file: "a.mp4", bytes: 10 });

    expect(history.isDone("1")).toBe(true);
    expect(history.doneCount).toBe(1);
  });

  it("un fallo no cuenta como descargado", () => {
    const { history } = makeHistory();

    history.mark("1", "error", { error: "boom" });

    expect(history.isDone("1")).toBe(false);
    expect(history.doneCount).toBe(0);
    expect(history.get("1")?.error).toBe("boom");
  });

  it("persiste entre instancias que comparten el storage", () => {
    const storage = new MemoryHistoryStorage();

    const first = new History(storage);
    first.load();
    first.mark("7", "ok", { bytes: 2048 });

    const second = new History(storage);
    second.load();

    expect(second.isDone("7")).toBe(true);
    expect(second.get("7")?.bytes).toBe(2048);
  });

  it("nunca guarda URLs ni tokens", () => {
    const { history, storage } = makeHistory();

    history.mark("1", "ok", { file: "a.mp4", bytes: 1, title: "Un título" });

    const raw = storage.getItem(history.key) ?? "";
    expect(raw).not.toContain("http");
    expect(raw).not.toContain("token");
    expect(raw).not.toContain("snapcdn");
  });

  it("borra todo el historial", () => {
    const { history, storage } = makeHistory();

    history.mark("1", "ok");
    history.clear();

    expect(history.size).toBe(0);
    expect(storage.getItem(history.key)).toBeNull();
  });

  it("tolera un storage ilegible y empieza de cero", () => {
    const storage = new MemoryHistoryStorage();
    storage.setItem("redly-history-v1", "{esto no es json");

    const history = new History(storage);
    history.load();

    expect(history.size).toBe(0);
  });

  it("con storage nulo funciona en memoria sin lanzar", () => {
    const history = new History(null);
    history.load();

    expect(() => history.mark("1", "ok")).not.toThrow();
    expect(history.isDone("1")).toBe(true);
    expect(() => history.clear()).not.toThrow();
  });

  it("sobrevive a un storage que lanza al escribir (cuota llena)", () => {
    const throwing = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {},
    };
    const history = new History(throwing);

    expect(() => history.mark("1", "ok")).not.toThrow();
    expect(history.isDone("1")).toBe(true);
  });

  it("lista sólo los ids marcados como ok", () => {
    const { history } = makeHistory();

    history.mark("a", "ok");
    history.mark("b", "error");
    history.mark("c", "ok");

    expect(history.doneIds().sort()).toEqual(["a", "c"]);
  });
});

describe("partitionByHistory", () => {
  const items = [{ id: "1" }, { id: "2" }, { id: "3" }];

  it("separa pendientes y descargados conservando el orden", () => {
    const { history } = makeHistory();
    history.mark("2", "ok");

    const { pending, done } = partitionByHistory(items, history);

    expect(pending.map((item) => item.id)).toEqual(["1", "3"]);
    expect(done.map((item) => item.id)).toEqual(["2"]);
  });

  it("con skip=false devuelve la cola entera", () => {
    const { history } = makeHistory();
    history.mark("2", "ok");

    const { pending, done } = partitionByHistory(items, history, false);

    expect(pending).toHaveLength(3);
    expect(done).toHaveLength(0);
  });
});
