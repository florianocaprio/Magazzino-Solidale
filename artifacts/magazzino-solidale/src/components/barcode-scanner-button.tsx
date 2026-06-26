import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { BrowserMultiFormatReader, type IScannerControls } from "@zxing/browser";
import { DecodeHintType, BarcodeFormat } from "@zxing/library";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { ScanLine, CameraOff } from "lucide-react";
import { cn } from "@/lib/utils";

const FORMATS = [
  BarcodeFormat.CODE_128,
  BarcodeFormat.CODE_39,
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.ITF,
  BarcodeFormat.CODABAR,
  BarcodeFormat.QR_CODE,
];

interface BarcodeScannerButtonProps {
  /** Called with the decoded barcode text once a code is recognized. */
  onScan: (value: string) => void;
  disabled?: boolean;
  className?: string;
  /** Show a text label next to the icon (default: icon-only). */
  withLabel?: boolean;
  /** Override the button label (defaults to the generic "Scan" string). */
  label?: string;
  variant?: "outline" | "secondary" | "default" | "ghost";
}

/**
 * Reusable camera barcode scanner. Renders a button that opens a dialog with a
 * live camera feed; once a barcode is decoded it calls `onScan` with the text
 * and closes. Works on iOS Safari + Android (getUserMedia + ZXing), requires an
 * HTTPS context (the Replit preview and published apps are served over HTTPS).
 */
export function BarcodeScannerButton({
  onScan,
  disabled,
  className,
  withLabel = false,
  label,
  variant = "outline",
}: BarcodeScannerButtonProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const onScanRef = useRef(onScan);

  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(null);

    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices ||
      !navigator.mediaDevices.getUserMedia
    ) {
      setError(t("barcodeScanner.errInsecure"));
      return;
    }

    const hints = new Map<DecodeHintType, unknown>();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, FORMATS);
    hints.set(DecodeHintType.TRY_HARDER, true);
    const reader = new BrowserMultiFormatReader(hints);

    const start = async () => {
      const video = videoRef.current;
      if (!video) return;
      try {
        const controls = await reader.decodeFromConstraints(
          { video: { facingMode: { ideal: "environment" } } },
          video,
          (result, _err, ctrl) => {
            if (!result) return;
            const text = result.getText().trim();
            if (!text) return;
            ctrl.stop();
            controlsRef.current = null;
            if (!cancelled) {
              onScanRef.current(text);
              setOpen(false);
            }
          },
        );
        if (cancelled) {
          controls.stop();
          return;
        }
        controlsRef.current = controls;
      } catch (e) {
        if (cancelled) return;
        const name = (e as { name?: string })?.name;
        if (name === "NotAllowedError" || name === "SecurityError") {
          setError(t("barcodeScanner.errPermission"));
        } else if (
          name === "NotFoundError" ||
          name === "DevicesNotFoundError" ||
          name === "OverconstrainedError"
        ) {
          setError(t("barcodeScanner.errNoCamera"));
        } else {
          setError(t("barcodeScanner.errGeneric"));
        }
      }
    };

    void start();

    return () => {
      cancelled = true;
      controlsRef.current?.stop();
      controlsRef.current = null;
    };
  }, [open, t]);

  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={withLabel ? "default" : "icon"}
        disabled={disabled}
        onClick={() => setOpen(true)}
        className={cn(withLabel && "gap-2", "shrink-0", className)}
        aria-label={label ?? t("barcodeScanner.button")}
        title={label ?? t("barcodeScanner.button")}
      >
        <ScanLine className="h-4 w-4" />
        {withLabel && (label ?? t("barcodeScanner.button"))}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("barcodeScanner.title")}</DialogTitle>
            <DialogDescription>{t("barcodeScanner.hint")}</DialogDescription>
          </DialogHeader>
          {error ? (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <CameraOff className="h-10 w-10 text-muted-foreground" />
              <p className="text-sm text-destructive">{error}</p>
            </div>
          ) : (
            <div className="relative aspect-[4/3] w-full overflow-hidden rounded-lg border bg-black">
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <video
                ref={videoRef}
                className="h-full w-full object-cover"
                muted
                playsInline
                autoPlay
              />
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="h-24 w-3/4 rounded-md border-2 border-white/70" />
              </div>
            </div>
          )}
          <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
            {t("barcodeScanner.cancel")}
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
