import { useEffect, useMemo, useState } from "react";
import Cropper from "react-easy-crop";
import type { Area } from "react-easy-crop";
import { Alert, Dialog, DialogTitle, DialogContent, DialogActions, Button, Slider, Box } from "@mui/material";
import { bakeToWebp, loadImage, type CropArea } from "../lib/avatarImage.js";

interface Props {
  open: boolean;
  file: File | null;
  onCancel: () => void;
  onSave: (blob: Blob) => void;
}

export function AvatarCropDialog({ open, file, onCancel, onSave }: Props) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<CropArea | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const url = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  // Reset transform whenever a new file is chosen.
  useEffect(() => { setCrop({ x: 0, y: 0 }); setZoom(1); setArea(null); setError(null); }, [file]);

  const save = async () => {
    if (busy || !file || !area) return;
    setBusy(true);
    setError(null);
    try {
      const img = await loadImage(file);
      const blob = await bakeToWebp(img, area);
      onSave(blob);
    } catch {
      setError("Не удалось обработать изображение.");
    } finally {
      setBusy(false);
    }
  };

  const handleCropComplete = (_croppedArea: Area, croppedAreaPixels: Area) => {
    setArea(croppedAreaPixels as CropArea);
  };

  return (
    <Dialog open={open} onClose={busy ? undefined : onCancel} fullWidth maxWidth="xs">
      <DialogTitle>Кадрирование</DialogTitle>
      <DialogContent>
        <Box sx={{ position: "relative", width: "100%", height: 300, bgcolor: "#222", borderRadius: 1 }}>
          {url && (
            <Cropper
              image={url}
              crop={crop}
              zoom={zoom}
              aspect={1}
              cropShape="round"
              showGrid={false}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={handleCropComplete}
            />
          )}
        </Box>
        <Slider
          aria-label="Масштаб"
          min={1}
          max={3}
          step={0.01}
          value={zoom}
          onChange={(_e: Event, v: number | number[]) => setZoom(v as number)}
          sx={{ mt: 2 }}
        />
        {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>Отмена</Button>
        <Button variant="contained" onClick={save} disabled={busy || !area}>Сохранить</Button>
      </DialogActions>
    </Dialog>
  );
}
