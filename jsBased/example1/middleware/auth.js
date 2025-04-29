// Authentication middleware
import dotenv from 'dotenv';
import createError from 'http-errors';

// Load environment variables
dotenv.config();

// Middleware to verify the AI moderator token
export const verifyToken = (req, res, next) => {
  // Get auth header
  const authHeader = req.headers.authorization;
  
  console.log('Auth header:', authHeader);
  console.log('Expected token:', process.env.AI_MODERATOR_TOKEN);
  
  // Check if auth header exists
  if (!authHeader) {
    return next(createError(401, 'Authorization header missing'));
  }
  
  // Check if it's a Bearer token
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return next(createError(401, 'Authorization header must be in format: Bearer <token>'));
  }
  
  const token = parts[1];
  console.log('Provided token:', token);
  console.log('Token match:', token === process.env.AI_MODERATOR_TOKEN);
  
  // Verify token
  if (token !== process.env.AI_MODERATOR_TOKEN) {
    return next(createError(401, 'Unauthorized'));
  }
  
  // Token is valid, proceed
  next();
};

