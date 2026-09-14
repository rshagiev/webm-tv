import test from "node:test";
import assert from "node:assert/strict";
import { VideoLibrary } from "../server/library-state.js";
import type { Board, Topic } from "../shared/model.js";
const board: Board = {
  id: "test",
  name: "Test",
  category: "Test",
  adult: false,
  threads: 2,
  video: true,
};
const topic = (id: string): Topic => ({
  id,
  board: "test",
  title: id,
  posts: 2,
  files: 1,
  opVideos: 0,
  updated: 1,
});
test("index completion requires every thread and is independent of the duration filter", () => {
  const l = new VideoLibrary();
  l.catalog("test", [topic("1"), topic("2")], [], 100);
  l.thread("test", "1", [], 200);
  assert.equal(l.board(board).indexState, "pending");
  assert.equal(l.topics("test")[0].indexState, "complete");
  l.failure("test", "2", "unavailable");
  assert.equal(l.board(board).indexState, "error");
  l.thread("test", "2", [], 300);
  assert.equal(l.board(board, 180).indexState, "complete");
  assert.equal(l.board(board).videoState, "empty");
  l.catalog("test", [{ ...topic("1"), posts: 3 }, topic("2")], [], 400);
  assert.equal(l.board(board).indexState, "pending");
  assert.equal(l.topics("test")[0].indexState, "pending");
});
