import 'server-only';
import {prisma} from '@/lib/db/prisma';

export async function getServerForDetail(id: string) {
  return prisma.server.findUnique({
    where: {id},
    select: {id: true, name: true, tag: true, baseUrl: true},
  });
}
