import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { db } from "./db"

const googleClientId = process.env.GOOGLE_CLIENT_ID
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET

/**
 * Google sign-in is enabled only when both OAuth credentials are present, so
 * the kit keeps working with email/password alone. Server-only: pages read it
 * and pass it to client components as a prop.
 */
export const isGoogleAuthEnabled = Boolean(googleClientId && googleClientSecret)

const socialProviders =
  googleClientId && googleClientSecret
    ? { google: { clientId: googleClientId, clientSecret: googleClientSecret } }
    : {}

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
  }),
  emailAndPassword: {
    enabled: true,
    sendResetPassword: async ({ user, url }) => {
      // Log password reset URL to terminal (no email integration yet)
      // eslint-disable-next-line no-console
      console.log(`\n${"=".repeat(60)}\nPASSWORD RESET REQUEST\nUser: ${user.email}\nReset URL: ${url}\n${"=".repeat(60)}\n`)
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    sendVerificationEmail: async ({ user, url }) => {
      // Log verification URL to terminal (no email integration yet)
      // eslint-disable-next-line no-console
      console.log(`\n${"=".repeat(60)}\nEMAIL VERIFICATION\nUser: ${user.email}\nVerification URL: ${url}\n${"=".repeat(60)}\n`)
    },
  },
  socialProviders,
})
