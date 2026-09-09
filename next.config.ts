import type {NextConfig} from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

// No `output: 'standalone'`. Nothing here runs the standalone server: the image
// and the release bundle both ship the full node_modules and start with
// `next start`, and the bundle builder explicitly excludes .next/standalone as
// redundant. Next 16 warns on every boot that the two do not go together, so the
// setting only produced an unused build output and a warning that trains people
// to ignore warnings.
const nextConfig: NextConfig = {
  typedRoutes: true,
};

export default withNextIntl(nextConfig);
