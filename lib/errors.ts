import type { ApiErrorCode } from '@/lib/contracts/http';

export class AppError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly details?: unknown;

  constructor(status: number, code: ApiErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function validationError(message: string, details?: unknown): AppError {
  return new AppError(400, 'VALIDATION_ERROR', message, details);
}

export function notFound(message: string): AppError {
  return new AppError(404, 'NOT_FOUND', message);
}

export function conflict(message: string): AppError {
  return new AppError(409, 'CONFLICT', message);
}

export function unprocessable(message: string, details?: unknown): AppError {
  return new AppError(422, 'UNPROCESSABLE_SOURCE', message, details);
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
