import { useState } from "react";
import {
  Box, Button, Dialog, DialogContent, DialogTitle, Link, Stack, TextField, Typography,
} from "@mui/material";
import { api } from "../api/client.js";
import { nicknameField, passwordField } from "../lib/validation.js";
import { useBackClose } from "../lib/useBackClose.js";
import type { AuthUser } from "../types.js";

type Mode = "register" | "login";

export function AuthScreen({ onAuthenticated }: { onAuthenticated: (u: AuthUser) => void }) {
  const [mode, setMode] = useState<Mode>("register");
  const [nickname, setNickname] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);
  useBackClose(forgot, () => setForgot(false));

  const submit = async () => {
    const n = nicknameField.safeParse(nickname);
    if (!n.success) { setError(n.error.issues[0].message); return; }
    const p = passwordField.safeParse(password);
    if (!p.success) { setError(p.error.issues[0].message); return; }
    setError(null);
    setBusy(true);
    try {
      const user = mode === "register"
        ? await api.register(n.data, p.data)
        : await api.login(n.data, p.data);
      onAuthenticated(user);
    } catch (e) {
      const msg = String((e as Error).message);
      if (msg.includes("409")) setError("Никнейм занят");
      else if (msg.includes("401")) setError("Неверный логин или пароль");
      else setError("Не удалось выполнить запрос");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box sx={{ minHeight: "100dvh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2, px: 3 }}>
      <Typography variant="h4" color="primary">Roles Mind Map</Typography>
      <Stack spacing={2} sx={{ width: "100%", maxWidth: 320 }}>
        <TextField label="Логин" value={nickname} inputProps={{ maxLength: 20 }}
          onChange={(e) => setNickname(e.target.value)} />
        <TextField label="Пароль" type="password" value={password} inputProps={{ maxLength: 30 }}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }} />
        {error && <Typography color="error" variant="body2">{error}</Typography>}

        {mode === "register" ? (
          <>
            <Button variant="contained" disabled={busy} onClick={submit}>Зарегистрироваться</Button>
            <Button onClick={() => { setError(null); setMode("login"); }}>Уже есть аккаунт</Button>
          </>
        ) : (
          <>
            <Button variant="contained" disabled={busy} onClick={submit}>Войти</Button>
            <Button onClick={() => setForgot(true)}>Забыли пароль?</Button>
          </>
        )}
      </Stack>

      <Dialog open={forgot} onClose={() => setForgot(false)}>
        <DialogTitle>Восстановление пароля</DialogTitle>
        <DialogContent>
          <Typography>
            Для восстановления пароля обратитесь к администратору сайта, контакты указаны на сайте:{" "}
            <Link href="https://mkv.qa/" target="_blank" rel="noopener">https://mkv.qa/</Link>
          </Typography>
        </DialogContent>
      </Dialog>
    </Box>
  );
}
