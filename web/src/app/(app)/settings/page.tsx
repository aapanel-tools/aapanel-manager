import {redirect} from 'next/navigation';
import type {Route} from 'next';

/** Settings index — send to the first section. */
export default function SettingsPage() {
  redirect('/settings/updates' as Route);
}
