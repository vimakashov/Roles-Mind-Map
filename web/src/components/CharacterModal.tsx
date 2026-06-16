import { useState } from "react";
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
  MenuItem, Stack, Box,
} from "@mui/material";
import type { Character, Gender, RelationEntry } from "../types.js";
import { characterFormSchema } from "../lib/validation.js";
import { Avatar } from "./Avatar.js";
import { RelationsModal } from "./RelationsModal.js";
import { ConfirmDialog } from "./ConfirmDialog.js";
import type { CharacterInput } from "../api/client.js";

interface Props {
  open: boolean;
  mode: "create" | "edit";
  others: Character[];
  initial?: CharacterInput;
  onCancel: () => void;
  onSubmit: (input: CharacterInput) => void;
  onDelete?: () => void;
}

const empty: CharacterInput = {
  gender: "male", firstName: "", lastName: "", middleName: "", age: null, relations: [],
};

export function CharacterModal({ open, mode, others, initial, onCancel, onSubmit, onDelete }: Props) {
  const [gender, setGender] = useState<Gender | "">(initial?.gender ?? "");
  const [firstName, setFirstName] = useState(initial?.firstName ?? "");
  const [lastName, setLastName] = useState(initial?.lastName ?? "");
  const [middleName, setMiddleName] = useState(initial?.middleName ?? "");
  const [age, setAge] = useState(initial?.age != null ? String(initial.age) : "");
  const [relations, setRelations] = useState<RelationEntry[]>(initial?.relations ?? empty.relations);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [relationsOpen, setRelationsOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

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
      lastName: lastName.trim(),
      middleName: middleName.trim() || null,
      age: age === "" ? null : Number(age),
      relations,
    });
  };

  return (
    <>
      <Dialog open={open} onClose={onCancel} fullScreen={false} fullWidth maxWidth="sm"
        PaperProps={{ sx: { maxHeight: "calc(100dvh - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 32px)" } }}>
        <DialogTitle>{mode === "create" ? "Новый персонаж" : "Персонаж"}</DialogTitle>
        <DialogContent dividers sx={{ overflowY: "auto" }}>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {gender && (
              <Box sx={{ display: "flex", justifyContent: "center" }}>
                <Avatar gender={gender as Gender} age={age === "" ? null : Number(age)} />
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
              helperText={errors.lastName ?? "До 30 символов"} onChange={(e) => setLastName(e.target.value)} />
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
