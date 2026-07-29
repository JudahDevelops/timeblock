import { signOut } from "@/server/actions/auth";

export function UserMenu({ email }: { email: string }) {
  return (
    <div className="space-y-2">
      <p className="truncate text-xs text-zinc-500" title={email}>
        {email}
      </p>
      <form action={signOut}>
        <button
          type="submit"
          className="text-xs text-zinc-500 underline-offset-4 transition-colors hover:text-zinc-900 hover:underline dark:hover:text-zinc-100"
        >
          Sign out
        </button>
      </form>
    </div>
  );
}
