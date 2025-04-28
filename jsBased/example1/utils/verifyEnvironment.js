export default function verifyEnvironment() {
  // Check for required environment variables
  const requiredVars = [
    // Add any required environment variables here
  ];
  
  const missing = requiredVars.filter(varName => !process.env[varName]);
  
  if (missing.length > 0) {
    console.warn(`Missing environment variables: ${missing.join(', ')}`);
  }
  
  return missing.length === 0;
}