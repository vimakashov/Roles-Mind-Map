import { Dialog, DialogTitle, DialogContent, DialogActions, Button } from "@mui/material";
import { useBackClose } from "../lib/useBackClose.js";

interface Props {
  open: boolean;
  canUseExisting: boolean;
  onExisting: () => void;
  onCreateNew: () => void;
  onCancel: () => void;
}

export function LinkChoiceDialog({ open, canUseExisting, onExisting, onCreateNew, onCancel }: Props) {
  useBackClose(open, onCancel);
  return (
    <Dialog open={open} onClose={onCancel} maxWidth="xs">
      <DialogTitle>Создать нового персонажа или связать с существующим?</DialogTitle>
      <DialogContent />
      <DialogActions>
        <Button disabled={!canUseExisting} onClick={onExisting}>Существующий</Button>
        <Button variant="contained" onClick={onCreateNew}>Новый персонаж</Button>
      </DialogActions>
    </Dialog>
  );
}
