// TODO(S1-02): replace with JWT guard exports so controllers require zero changes.
export { DevAuthService } from './dev-auth.service';
export {
  DevAuthGuard,
  OptionalDevAuthGuard,
  DevAuthGuard as AuthGuard,
  OptionalDevAuthGuard as OptionalAuthGuard,
} from './dev-auth.guard';
