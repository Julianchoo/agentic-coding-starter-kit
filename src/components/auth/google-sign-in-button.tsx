"use client"

import { useState } from "react"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { signIn } from "@/lib/auth-client"

/** Google's multi-color "G" mark (Lucide ships no brand icons). */
function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4">
      <path
        fill="#4285F4"
        d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.46a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.58-5.17 3.58-8.81Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.07 7.94-2.92l-3.88-3c-1.07.72-2.45 1.15-4.06 1.15-3.13 0-5.78-2.11-6.72-4.95H1.27v3.1A12 12 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.28 14.28A7.2 7.2 0 0 1 4.9 12c0-.79.14-1.56.38-2.28v-3.1H1.27a12 12 0 0 0 0 10.76l4.01-3.1Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.77c1.76 0 3.34.61 4.59 1.8l3.44-3.44A11.97 11.97 0 0 0 12 0 12 12 0 0 0 1.27 6.62l4.01 3.1C6.22 6.88 8.87 4.77 12 4.77Z"
      />
    </svg>
  )
}

interface GoogleSignInButtonProps {
  /** Where Better Auth redirects after a successful Google sign-in. */
  callbackURL?: string
}

export function GoogleSignInButton({ callbackURL = "/dashboard" }: GoogleSignInButtonProps) {
  const [error, setError] = useState("")
  const [isPending, setIsPending] = useState(false)

  const handleClick = async () => {
    setError("")
    setIsPending(true)
    try {
      // On success the browser navigates to Google, so pending stays true.
      const result = await signIn.social({ provider: "google", callbackURL })
      if (result.error) {
        setError(result.error.message || "Failed to sign in with Google")
        setIsPending(false)
      }
    } catch {
      setError("An unexpected error occurred")
      setIsPending(false)
    }
  }

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        className="w-full"
        onClick={handleClick}
        disabled={isPending}
      >
        {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <GoogleIcon />}
        Continue with Google
      </Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}

/** "or" divider between social and email/password forms. */
export function AuthDivider() {
  return (
    <div className="flex items-center gap-3">
      <div className="h-px flex-1 bg-border" />
      <span className="text-xs text-muted-foreground uppercase">or</span>
      <div className="h-px flex-1 bg-border" />
    </div>
  )
}
