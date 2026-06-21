import { useEffect, useMemo, useState } from "react";
import { useBackClose } from "../lib/useBackClose.js";
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
  MenuItem, Stack, Box, IconButton, Menu,
} from "@mui/material";
import type { Character, Gender, RelationEntry } from "../types.js";
import { characterFormSchema } from "../lib/validation.js";
import { Avatar } from "./Avatar.js";
import { RelationsModal } from "./RelationsModal.js";
import { ConfirmDialog } from "./ConfirmDialog.js";
import { AvatarCropDialog } from "./AvatarCropDialog.js";
import { ACCEPT_ATTR, validateFileBasics, validateDimensions, loadImage } from "../lib/avatarImage.js";
import { api } from "../api/client.js";
import type { CharacterInput } from "../api/client.js";

export type AvatarChange =
  | { kind: "none" }
  | { kind: "set"; blob: Blob }
  | { kind: "remove" };

interface Props {
  open: boolean;
  mode: "create" | "edit";
  others: Character[];
  initial?: CharacterInput;
  characterId?: string;
  avatarUpdatedAt?: string | null;
  onCancel: () => void;
  onSubmit: (input: CharacterInput, avatar: AvatarChange) => void;
  onDelete?: () => void;
}

const empty: CharacterInput = {
  gender: "male", firstName: "", lastName: "", middleName: "", age: null, relations: [],
};

export function CharacterModal({
  open, mode, others, initial, characterId, avatarUpdatedAt, onCancel, onSubmit, onDelete,
}: Props) {
  const [gender, setGender] = useState<Gender | "">(initial?.gender ?? "");
  const [firstName, setFirstName] = useState(initial?.firstName ?? "");
  const [lastName, setLastName] = useState(initial?.lastName ?? "");
  const [middleName, setMiddleName] = useState(initial?.middleName ?? "");
  const [age, setAge] = useState(initial?.age != null ? String(initial.age) : "");
  const [relations, setRelations] = useState<RelationEntry[]>(initial?.relations ?? empty.relations);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [relationsOpen, setRelationsOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Avatar staging.
  const [avatar, setAvatar] = useState<AvatarChange>({ kind: "none" });
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  const hasCustom =
    avatar.kind === "set" || (avatar.kind !== "remove" && !!avatarUpdatedAt);

  const blobUrl = useMemo(
    () => (avatar.kind === "set" ? URL.createObjectURL(avatar.blob) : null),
    [avatar],
  );
  useEffect(() => () => { if (blobUrl) URL.revokeObjectURL(blobUrl); }, [blobUrl]);
  const avatarSrc =
    avatar.kind === "set" ? blobUrl
    : avatar.kind === "remove" ? null
    : avatarUpdatedAt && characterId ? api.avatarUrl(characterId, avatarUpdatedAt)
    : null;

  useBackClose(open, onCancel);
  useBackClose(!!menuAnchor, () => setMenuAnchor(null));

  const pickFile = (input: HTMLInputElement) => {
    const file = input.files?.[0];
    input.value = ""; // allow re-picking the same file
    if (!file) return;
    setAvatarError(null);
    const basic = validateFileBasics(file);
    if (basic) { setAvatarError(basic); return; }
    if (file.type === "image/svg+xml") { setCropFile(file); return; } // no pixel dims to check
    loadImage(file)
      .then((img) => {
        const dimErr = validateDimensions(img.naturalWidth, img.naturalHeight);
        if (dimErr) { setAvatarError(dimErr); return; }
        setCropFile(file);
      })
      .catch(() => setAvatarError("Не удалось загрузить изображение."));
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setMenuAnchor(null);
    pickFile(e.currentTarget);
  };

  const submit = () => {
    const result = characterFormSchema.safeParse({ gender, firstName, lastName, middleName, age });
    if (!result.success) {
      const flat: Record<string, string> = {};
      for (const issue of result.error.issues) flat[String(issue.path[0])] = issue.message;
      setErrors(flat);
      return;
    }
    setErrors({});
    onSubmit({
      gender: gender as Gender,
      firstName: firstName.trim(),
      lastName: lastName.trim() || null,
      middleName: middleName.trim() || null,
      age: age === "" ? null : Number(age),
      relations,
    }, avatar);
  };

  return (
    <>
      <Dialog open={open} onClose={onCancel} fullScreen={false} fullWidth maxWidth="sm"
        PaperProps={{ sx: { maxHeight: "calc(100dvh - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 32px)" } }}>
        <DialogTitle>{mode === "create" ? "Новый персонаж" : "Персонаж"}</DialogTitle>
        <DialogContent dividers sx={{ overflowY: "auto" }}>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {gender && (
              <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 0.5 }}>
                <IconButton
                  data-testid="avatar-button"
                  onClick={(e) => setMenuAnchor(e.currentTarget)}
                  sx={{ p: 0, borderRadius: "50%" }}
                  aria-label="Аватар"
                >
                  <Avatar gender={gender as Gender} age={age === "" ? null : Number(age)} src={avatarSrc} />
                </IconButton>
                {avatarError && (
                  <Box sx={{ color: "error.main", fontSize: 12, textAlign: "center" }}>{avatarError}</Box>
                )}
              </Box>
            )}
            <TextField select label="Пол" value={gender} error={!!errors.gender} helperText={errors.gender ?? "Обязательно"}
              onChange={(e) => setGender(e.target.value as Gender)}>
              <MenuItem value="male">Мужчина</MenuItem>
              <MenuItem value="female">Женщина</MenuItem>
            </TextField>
            <TextField label="Имя" value={firstName} inputProps={{ maxLength: 30 }} error={!!errors.firstName}
              helperText={errors.firstName ?? "До 30 символов"} onChange={(e) => setFirstName(e.target.value)} />
            <TextField label="Фамилия" value={lastName} inputProps={{ maxLength: 30 }} error={!!errors.lastName}
              helperText={errors.lastName ?? "Необязательно, до 30 символов"} onChange={(e) => setLastName(e.target.value)} />
            <TextField label="Отчество" value={middleName} inputProps={{ maxLength: 30 }} error={!!errors.middleName}
              helperText={errors.middleName ?? "Необязательно, до 30 символов"} onChange={(e) => setMiddleName(e.target.value)} />
            <TextField label="Возраст" value={age} error={!!errors.age}
              helperText={errors.age ?? "Необязательно, 0–100"} onChange={(e) => setAge(e.target.value)} />
            <Box>
              <Button variant="outlined" onClick={() => setRelationsOpen(true)}>
                Связи ({relations.length})
              </Button>
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ position: "sticky", bottom: 0, bgcolor: "background.paper" }}>
          {mode === "edit" && onDelete && (
            <Button color="error" onClick={() => setConfirmOpen(true)} sx={{ mr: "auto" }}>Удалить</Button>
          )}
          <Button onClick={onCancel}>Отмена</Button>
          <Button variant="contained" onClick={submit}>{mode === "create" ? "Добавить" : "Сохранить"}</Button>
        </DialogActions>
      </Dialog>

      <Menu anchorEl={menuAnchor} open={!!menuAnchor} onClose={() => setMenuAnchor(null)}>
        {hasCustom
          ? [
              <MenuItem key="change" component="label">
                Изменить
                <input hidden type="file" accept={ACCEPT_ATTR}
                  onChange={handleFileChange} />
              </MenuItem>,
              <MenuItem key="remove" onClick={() => { setAvatar({ kind: "remove" }); setMenuAnchor(null); }}>
                Удалить
              </MenuItem>,
            ]
          : (
            <MenuItem key="add" component="label">
              Добавить
              <input hidden type="file" accept={ACCEPT_ATTR}
                onChange={handleFileChange} />
            </MenuItem>
          )}
      </Menu>

      <AvatarCropDialog
        open={!!cropFile}
        file={cropFile}
        onCancel={() => setCropFile(null)}
        onSave={(blob) => { setAvatar({ kind: "set", blob }); setCropFile(null); }}
      />

      <RelationsModal open={relationsOpen} others={others} value={relations}
        onCancel={() => setRelationsOpen(false)}
        onSave={(e) => { setRelations(e); setRelationsOpen(false); }} />

      <ConfirmDialog open={confirmOpen} title="Удалить персонажа?"
        message="Это действие необратимо. Связи персонажа также будут удалены."
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => { setConfirmOpen(false); onDelete?.(); }} />
    </>
  );
}
