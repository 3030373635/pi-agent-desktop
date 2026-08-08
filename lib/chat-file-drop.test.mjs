import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const {
  mentionPathsForUploadResult,
  partitionChatDroppedFiles,
} = await createJiti(import.meta.url, { tsconfigPaths: true })
  .import("./chat-file-drop.ts");

function fakeFile(name, type) {
  return new File([new Uint8Array([1, 2, 3])], name, { type });
}

test("partitionChatDroppedFiles sends images to attachments and docs to the project", () => {
  const { images, projectFiles } = partitionChatDroppedFiles([
    fakeFile("shot.png", "image/png"),
    fakeFile("notes.md", "text/markdown"),
    fakeFile("report.pdf", "application/pdf"),
    fakeFile("photo.jpeg", "image/jpeg"),
  ]);

  assert.deepEqual(images.map((file) => file.name), ["shot.png", "photo.jpeg"]);
  assert.deepEqual(projectFiles.map((file) => file.name), ["notes.md", "report.pdf"]);
});

test("partitionChatDroppedFiles drops empty and path-like names", () => {
  const { images, projectFiles } = partitionChatDroppedFiles([
    fakeFile("", "text/plain"),
    fakeFile("..", "text/plain"),
    fakeFile("a/b.txt", "text/plain"),
    fakeFile("ok.txt", ""),
  ]);
  assert.equal(images.length, 0);
  assert.deepEqual(projectFiles.map((file) => file.name), ["ok.txt"]);
});

test("mentionPathsForUploadResult includes uploaded and skipped names", () => {
  assert.deepEqual(
    mentionPathsForUploadResult({
      uploaded: ["new.md"],
      skipped: ["existing.pdf"],
      errors: [{ name: "bad", error: "nope" }],
    }),
    ["new.md", "existing.pdf"],
  );
});
