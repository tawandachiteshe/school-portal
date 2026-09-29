// The institution's name, where copy names it. Set at build time from COLLEGE_NAME (docker-compose passes
// it as VITE_COLLEGE_NAME); the API reads the same variable.
export const COLLEGE: string = import.meta.env.VITE_COLLEGE_NAME || 'Campus College'
