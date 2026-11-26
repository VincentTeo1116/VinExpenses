// The language of a public page comes from its address (/ms/..., /zh/...), so a shared link always opens in the language it was shared in.
import { useLocation } from 'react-router-dom';
import { langOfPath, type PageLang } from './registry';
import { UI, type UiText } from './text';

export const usePageLang = (): PageLang => langOfPath(useLocation().pathname);

export const useUi = (): UiText => UI[usePageLang()];
