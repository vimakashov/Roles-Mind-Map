import { AppBar, Toolbar, Typography, IconButton, Box } from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import DeleteIcon from "@mui/icons-material/Delete";

interface Props {
  onBack?: () => void;
  onDelete?: () => void;
}

export function TopBar({ onBack, onDelete }: Props) {
  return (
    <AppBar position="sticky" color="primary" sx={{ pt: "env(safe-area-inset-top)" }}>
      <Toolbar>
        <Box sx={{ width: 48 }}>
          {onBack && (
            <IconButton edge="start" color="inherit" aria-label="назад" onClick={onBack}>
              <ArrowBackIcon />
            </IconButton>
          )}
        </Box>
        <Typography variant="h6" sx={{ flex: 1, textAlign: "center" }}>
          Roles Mind Map
        </Typography>
        <Box sx={{ width: 48 }}>
          {onDelete && (
            <IconButton edge="end" color="inherit" aria-label="удалить книгу" onClick={onDelete}>
              <DeleteIcon />
            </IconButton>
          )}
        </Box>
      </Toolbar>
    </AppBar>
  );
}
