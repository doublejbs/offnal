import { type NextResponse } from 'next/server';

import { type IssuedToken } from '@/server/auth/SessionService';
import { getAppConfig } from '@/server/config/AppConfig';

export const SESSION_COOKIE_NAME = 'offnal_session';
export const ANONYMOUS_COOKIE_NAME = 'offnal_anon';

export type CookieOptions = {
  httpOnly: boolean;
  sameSite: 'lax';
  path: string;
  secure: boolean;
  expires: Date;
};

export const isSecureAppUrl = (): boolean => getAppConfig().appUrl.startsWith('https://');

/** HttpOnly; SameSite=Lax; Path=/; Secure when APP_URL is https (Spec §6). */
export const buildCookieOptions = (expiresAt: Date): CookieOptions => ({
  httpOnly: true,
  sameSite: 'lax',
  path: '/',
  secure: isSecureAppUrl(),
  expires: expiresAt,
});

export const clearCookie = (response: NextResponse, name: string): void => {
  response.cookies.set(name, '', { ...buildCookieOptions(new Date(0)), maxAge: 0 });
};

export const setSessionCookie = (response: NextResponse, issued: IssuedToken): void => {
  response.cookies.set(SESSION_COOKIE_NAME, issued.token, buildCookieOptions(issued.expiresAt));
};

export const clearSessionCookie = (response: NextResponse): void => {
  clearCookie(response, SESSION_COOKIE_NAME);
};

export const setAnonymousCookie = (response: NextResponse, issued: IssuedToken): void => {
  response.cookies.set(ANONYMOUS_COOKIE_NAME, issued.token, buildCookieOptions(issued.expiresAt));
};
