import { AppBar, Toolbar, Typography, IconButton, Box } from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";

interface Props {
  onBack?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}

export function TopBar({ onBack, onEdit, onDelete }: Props) {
  return (
    <AppBar position="sticky" color="primary" sx={{ pt: "env(safe-area-inset-top)" }}>
      <Toolbar>
        <Box sx={{ width: 96 }}>
          {onBack && (
            <IconButton edge="start" color="inherit" aria-label="назад" onClick={onBack}>
              <ArrowBackIcon />
            </IconButton>
          )}
        </Box>
        <Typography variant="h6" sx={{ flex: 1, textAlign: "center" }}>
          Roles Mind Map
        </Typography>
        <Box sx={{ width: 96, textAlign: "right" }}>
          {onEdit && (
            <IconButton color="inherit" aria-label="переименовать книгу" onClick={onEdit}>
              <EditIcon />
            </IconButton>
          )}
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
