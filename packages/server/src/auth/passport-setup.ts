import passport from 'passport';
import { Strategy as LocalStrategy } from 'passport-local';
import bcrypt from 'bcrypt';
import { UserRepo } from '../db/repositories/user.repo.js';

export function setupPassport(userRepo: UserRepo) {
  passport.serializeUser((user: Express.User, done) => {
    done(null, user.id);
  });

  passport.deserializeUser(async (id: number, done) => {
    try {
      const user = await userRepo.findById(id);
      if (!user) return done(null, false);
      done(null, {
        id: user.id,
        username: user.username,
        role: user.role,
        display_name: user.display_name,
      });
    } catch (err) {
      done(err);
    }
  });

  // Local strategy
  passport.use(new LocalStrategy(async (username, password, done) => {
    try {
      const user = await userRepo.findByUsername(username);
      if (!user || !user.password_hash) {
        return done(null, false, { message: 'Invalid credentials' });
      }
      const valid = await bcrypt.compare(password, user.password_hash);
      if (!valid) {
        return done(null, false, { message: 'Invalid credentials' });
      }
      done(null, {
        id: user.id,
        username: user.username,
        role: user.role,
        display_name: user.display_name,
      });
    } catch (err) {
      done(err);
    }
  }));

  return passport;
}
