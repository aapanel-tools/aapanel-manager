'use client';

import {useState, useTransition} from 'react';
import {useTranslations} from 'next-intl';
import {toast} from 'sonner';
import {changeOwnPasswordAction, type UserMutResult} from '@/server/actions/users';
import {KNOWN_USER_ERRORS} from '@/components/users/errors';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from '@/components/ui/card';

const INITIAL: UserMutResult = {ok: false, error: ''};

export function ChangeOwnPasswordCard() {
  const t = useTranslations('users');
  const [result, setResult] = useState<UserMutResult>(INITIAL);
  const [pending, start] = useTransition();
  const [formKey, setFormKey] = useState(0);

  const errText = (code: string) => (KNOWN_USER_ERRORS.has(code) ? t(`err.${code}`) : code);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    start(async () => {
      const res = await changeOwnPasswordAction(fd);
      setResult(res);
      if (res.ok) {
        toast.success(t('passwordChangedToast'));
        setFormKey((k) => k + 1); // clear the fields
      } else if (res.error !== 'validation') {
        toast.error(errText(res.error));
      }
    });
  }

  const fieldErr = (name: string): string | undefined =>
    !result.ok && result.fieldErrors ? result.fieldErrors[name]?.[0] : undefined;

  return (
    <Card>
      <form key={formKey} onSubmit={onSubmit}>
        <CardHeader>
          <CardTitle>{t('changePasswordTitle')}</CardTitle>
          <CardDescription>{t('changePasswordHint')}</CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {!result.ok && result.error && result.error !== 'validation' ? (
            <p className="text-sm text-destructive" role="alert">
              {errText(result.error)}
            </p>
          ) : null}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="cp-current">{t('currentPassword')}</Label>
              <Input id="cp-current" name="currentPassword" type="password" required autoComplete="current-password" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cp-new">{t('passwordNew')}</Label>
              <Input id="cp-new" name="newPassword" type="password" required autoComplete="new-password" />
              <p className="text-xs text-muted-foreground">{t('passwordHint')}</p>
              {fieldErr('newPassword') ? (
                <p className="text-xs text-destructive">{fieldErr('newPassword')}</p>
              ) : null}
            </div>
          </div>
        </CardContent>

        <CardFooter className="justify-end">
          <Button type="submit" disabled={pending}>
            {t('change')}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
