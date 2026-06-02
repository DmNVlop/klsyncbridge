'use strict';

class AppError extends Error {
  constructor(message, code = 'APP_ERROR', statusCode = 500) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

class ValidationError extends AppError {
  constructor(message, details = null) {
    super(message, 'VALIDATION_ERROR', 400);
    this.name = 'ValidationError';
    this.details = details;
  }
}

class NotFoundError extends AppError {
  constructor(resource = 'Recurso') {
    super(`${resource} no encontrado`, 'NOT_FOUND', 404);
    this.name = 'NotFoundError';
  }
}

class AuthenticationError extends AppError {
  constructor(message = 'No autorizado') {
    super(message, 'UNAUTHORIZED', 401);
    this.name = 'AuthenticationError';
  }
}

class ForbiddenError extends AppError {
  constructor(message = 'Acceso denegado') {
    super(message, 'FORBIDDEN', 403);
    this.name = 'ForbiddenError';
  }
}

class ConflictError extends AppError {
  constructor(message) {
    super(message, 'CONFLICT', 409);
    this.name = 'ConflictError';
  }
}

class KLSyncBridgeError extends AppError {
  constructor(category, originalError, attempts = 0) {
    super(originalError.message || 'Error de sincronización', `SYNC_${category}`, 500);
    this.name = 'KLSyncBridgeError';
    this.category = category;
    this.originalError = originalError;
    this.attempts = attempts;
  }
}

class EncryptionError extends AppError {
  constructor(message = 'Error de cifrado') {
    super(message, 'ENCRYPTION_ERROR', 500);
    this.name = 'EncryptionError';
  }
}

class DatabaseError extends AppError {
  constructor(message) {
    super(message, 'DATABASE_ERROR', 500);
    this.name = 'DatabaseError';
  }
}

module.exports = {
  AppError,
  ValidationError,
  NotFoundError,
  AuthenticationError,
  ForbiddenError,
  ConflictError,
  KLSyncBridgeError,
  EncryptionError,
  DatabaseError,
};
