import { ShieldAlert } from "lucide-react";

export default function NotAuthorized() {
  return (
    <div className="flex h-full min-h-[60vh] flex-col items-center justify-center gap-3 p-6 text-center">
      <ShieldAlert className="h-10 w-10 text-muted-foreground" />
      <h1 className="text-lg font-semibold">Area non consentita</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        Il tuo ruolo non dispone dei permessi per accedere a questa sezione.
        Contatta un amministratore se ritieni si tratti di un errore.
      </p>
    </div>
  );
}
