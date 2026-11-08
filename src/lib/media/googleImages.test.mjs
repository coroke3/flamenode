import assert from "node:assert/strict";
import test from "node:test";
import { cachedGoogleImageUrl, extractGoogleDriveImageId, googleDriveImageCacheUrl } from "./googleImages.ts";

const fileId = "FILEID123456";

test("CURRENT Google image cache accepts HTTP(S) Drive and googleusercontent source URLs", () => {
  for (const scheme of ["https", "http"]) {
    for (const source of [
      `${scheme}://drive.google.com/uc?id=${fileId}`,
      `${scheme}://drive.google.com/file/d/${fileId}/view`,
      `${scheme}://lh3.googleusercontent.com/d/${fileId}`,
    ]) {
      assert.equal(extractGoogleDriveImageId(source), fileId, source);
      assert.equal(cachedGoogleImageUrl(source), `/api/google-drive-image/${fileId}`, source);
    }
  }
  assert.equal(googleDriveImageCacheUrl(fileId), `/api/google-drive-image/${fileId}`);
});

test("CURRENT non-HTTP Google host URLs must not be promoted into cache URLs", () => {
  for (const scheme of ["ftp", "file"]) {
    for (const source of [
      `${scheme}://drive.google.com/uc?id=${fileId}`,
      `${scheme}://drive.google.com/file/d/${fileId}/view`,
      `${scheme}://lh3.googleusercontent.com/d/${fileId}`,
    ]) {
      assert.equal(extractGoogleDriveImageId(source), null, source);
      assert.equal(cachedGoogleImageUrl(source), source, source);
    }
  }
});
