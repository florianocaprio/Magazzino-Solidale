import { createHash } from "node:crypto";
import type { Page, TestInfo } from "@playwright/test";
import QRCode from "qrcode";

export function cameraCardCode({ testId, retry, repeatEachIndex }: TestInfo) {
  const token = createHash("sha256")
    .update(JSON.stringify([testId, retry, repeatEachIndex]))
    .digest()
    .subarray(0, 24)
    .toString("base64url");
  return `MS-${token}`;
}

export async function useQrCamera(page: Page, code: string) {
  // Keep each QR module at its original pixel size and vary its orientation
  // so the decoder sees the card as it would while someone moves it.
  const qr = await QRCode.toDataURL(code, { scale: 8 });
  await page.addInitScript((source) => {
    navigator.mediaDevices.getUserMedia = async () => {
      const image = new Image();
      image.src = source;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = image.naturalWidth;
      const context = canvas.getContext("2d")!;
      const stream = canvas.captureStream(10);
      const [track] = stream.getVideoTracks();
      const center = canvas.width / 2;
      const started = performance.now();

      const draw = () => {
        if (track.readyState === "ended") return;
        const turn = Math.floor((performance.now() - started) / 500) % 4;
        context.save();
        context.translate(center, center);
        context.rotate(turn * Math.PI / 2);
        context.drawImage(image, -center, -center);
        context.restore();
        setTimeout(draw, 100);
      };

      draw();
      return stream;
    };
  }, qr);
}
