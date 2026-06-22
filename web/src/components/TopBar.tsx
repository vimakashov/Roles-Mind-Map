import { AppBar, Toolbar, Typography, IconButton, Box } from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";

interface Props {
  title?: string;
  onBack?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}

export function TopBar({ title, onBack, onEdit, onDelete }: Props) {
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
        <Typography
          variant="h6"
          noWrap
          sx={{ flex: 1, textAlign: "center", overflow: "hidden", textOverflow: "ellipsis" }}
        >
          {title || "Roles Mind Map"}
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
