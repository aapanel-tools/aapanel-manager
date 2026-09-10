'use client';

import {useCallback} from 'react';
import {useTranslations} from 'next-intl';
import {FIELD} from '@/lib/validation/messages';

/**
 * Says what is wrong with a field, in the reader's language.
 *
 * The twin of useActionError(): that one puts an action's refusal into words,
 * this one does the same for the check that a single field failed. Both exist
 * because the server cannot do it — a schema validates a form before anyone
 * knows who is going to read the answer — and both keep the sentences on the
 * side of the boundary where the locale lives.
 *
 * Anything the schemas did not name explicitly comes back as the generic
 * phrase rather than as zod's own English. That is deliberate: it means an
 * unannotated constraint costs precision, never a foreign-language message in
 * the middle of a translated form (Д-24).
 *
 * Keys are read through a switch over literals rather than `t(key)`.
 * messages.test.ts skips dynamic keys on purpose, so the shorter version would
 * put every one of these strings outside the gate — the blind spot Д-17, Д-20
 * and Д-23 were each about.
 */
export function useFieldError(): (raw: string | undefined) => string | undefined {
  const t = useTranslations('fieldError');

  return useCallback(
    (raw: string | undefined): string | undefined => {
      if (raw === undefined) return undefined;
      switch (raw) {
        case FIELD.required:
          return t('required');
        case FIELD.tooLong:
          return t('tooLong');
        case FIELD.nameCharset:
          return t('nameCharset');
        case FIELD.identifierCharset:
          return t('identifierCharset');
        case FIELD.scriptKey:
          return t('scriptKey');
        case FIELD.nodeVersion:
          return t('nodeVersion');
        case FIELD.absolutePath:
          return t('absolutePath');
        case FIELD.noParentDir:
          return t('noParentDir');
        case FIELD.httpUrl:
          return t('httpUrl');
        case FIELD.invalidUrl:
          return t('invalidUrl');
        case FIELD.invalidEmail:
          return t('invalidEmail');
        case FIELD.passwordShort:
          return t('passwordShort');
        case FIELD.apiSkShort:
          return t('apiSkShort');
        case FIELD.fingerprintLength:
          return t('fingerprintLength');
        case FIELD.passwordSame:
          return t('passwordSame');
        case FIELD.confirmName:
          return t('confirmName');
        case FIELD.portRange:
          return t('portRange');
        default:
          // zod's own wording for a missing value, a malformed email, a string
          // past its limit — English, every one of them.
          return t('invalid');
      }
    },
    [t],
  );
}
