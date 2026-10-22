import { Observable } from 'rxjs';
import { PackageLimits } from '../models/package-limits';

/**
 * The organisation's package limits and use (GET /api/me/limits, docs/18 D16). Undefined when the person can't see
 * them (no subscription permission) or the prototype has none: the warning simply doesn't show.
 */
export abstract class PackageLimitsDataSource {
  abstract usage(): Observable<PackageLimits | undefined>;
}
