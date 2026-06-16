import { Dialog, DialogActions, DialogContent, DialogTitle, Button } from "@mui/material";

interface Props {
  open: boolean;
  title: string;
  message: string;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmDialog({ open, title, message, onCancel, onConfirm }: Props) {
  return (
    <Dialog open={open} onClose={onCancel}>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>{message}</DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>Отмена</Button>
        <Button color="error" onClick={onConfirm}>Удалить</Button>
      </DialogActions>
    </Dialog>
  );
}
