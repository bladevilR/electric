import { listBusinessTargets } from './jspec-targets.mjs';

export function buildJspecSpaUrl(routeFragment) {
  const route = String(routeFragment ?? '').trim();
  if (!route.startsWith('/')) {
    throw new Error(`JSPEC route fragment must start with "/": ${routeFragment}`);
  }

  const appName = route.split('/').filter(Boolean)[0];
  if (!appName) {
    throw new Error(`Could not infer JSPEC app name from route: ${routeFragment}`);
  }

  return `https://www.jspec.com.cn/${appName}/#${route}`;
}

export function getTargetsByIds(ids) {
  const lookup = new Map(listBusinessTargets().map((target) => [target.id, target]));
  return ids.map((id) => {
    const target = lookup.get(id);
    if (!target) {
      throw new Error(`Unknown JSPEC target id: ${id}`);
    }
    return target;
  });
}
