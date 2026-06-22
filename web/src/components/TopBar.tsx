import { AppBar, Toolbar, Typography, IconButton, Box } from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import ShareIcon from "@mui/icons-material/Share";

interface Props {
  title?: string;
  onBack?: () => void;
  onShare?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}

export function TopBar({ title, onBack, onShare, onEdit, onDelete }: Props) {
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
        <Box sx={{ minWidth: 96, display: "flex", justifyContent: "flex-end" }}>
          {onShare && (
            <IconButton color="inherit" aria-label="поделиться" onClick={onShare}>
              <ShareIcon />
            </IconButton>
          )}
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
