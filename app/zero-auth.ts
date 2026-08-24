const ZERO_API = "https://api.zero.xyz";
const ZERO_SDK_VERSION = "1.33.0";

export type ZeroUser = {
  id: string;
  email: string | null;
  walletAddress: string | null;
};

export class ZeroAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZeroAuthError";
  }
}

export async function getZeroUser(request: Request): Promise<ZeroUser | null> {
  const authorization = request.headers.get("authorization");
  if (!authorization) return null;
  if (!authorization.startsWith("Bearer ")) throw new ZeroAuthError("Your Zero authorization is invalid.");

  const response = await fetch(`${ZERO_API}/v1/users/me/profile`, {
    headers: {
      authorization,
      "x-zero-sdk-version": ZERO_SDK_VERSION,
    },
  });

  if (!response.ok) throw new ZeroAuthError("Your Zero session is invalid or expired.");
  const profile = (await response.json()) as {
    user?: { id?: string; email?: string | null };
    walletAddress?: string | null;
  };
  if (!profile.user?.id) throw new ZeroAuthError("Zero did not return a valid identity.");

  return {
    id: profile.user.id,
    email: profile.user.email ?? null,
    walletAddress: profile.walletAddress ?? null,
  };
}

export async function requireZeroUser(request: Request): Promise<ZeroUser> {
  const user = await getZeroUser(request);
  if (!user) throw new ZeroAuthError("Sign in with Zero to continue.");
  return user;
}
