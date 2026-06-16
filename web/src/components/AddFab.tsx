import { Fab } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";

export function AddFab({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <Fab color="primary" aria-label={label} onClick={onClick}
      sx={{
        position: "fixed",
        right: "calc(16px + env(safe-area-inset-right))",
        bottom: "calc(16px + env(safe-area-inset-bottom))",
      }}>
      <AddIcon />
    </Fab>
  );
}
