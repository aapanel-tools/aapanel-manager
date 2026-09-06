import Link from 'next/link';
import {getTranslations} from 'next-intl/server';

export default async function ServerNotFound() {
  const t = await getTranslations('detail');
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
      <p className="text-lg text-muted-foreground">{t('notFound')}</p>
      <Link href="/servers" className="text-sm underline hover:no-underline">
        {t('backToServers')}
      </Link>
    </div>
  );
}
