import {useState} from 'react';

import {Button} from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {FormLayout, Selector, TextArea, TextInput} from '@/components/fields';

import {ApiError, api} from '../api/client';
import type {TransitionOption} from '../api/types';
import {Failure} from './Feedback';

// Виды артефактов, которых ждут гейты на выходе из текущего статуса. Список
// приходит из вердикта гейтов, а не из справочника в коде: чего именно не
// хватает, знает бэкенд.
function expectedKinds(transitions: TransitionOption[]): string[] {
  const kinds = new Set<string>();
  for (const t of transitions) {
    for (const gate of t.gates) {
      for (const kind of (gate.details?.required as string[]) ?? []) kinds.add(kind);
    }
  }
  return [...kinds];
}

export function SubmitArtifactDialog({
  taskKey,
  transitions,
  onSubmitted,
}: {
  taskKey: string;
  transitions: TransitionOption[];
  onSubmitted: () => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [kind, setKind] = useState('');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [error, setError] = useState<ApiError>();
  const [busy, setBusy] = useState(false);

  const kinds = expectedKinds(transitions);

  const submit = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await api.submitArtifact(taskKey, {
        kind,
        title: title || kind,
        format: 'markdown',
        content,
      });
      setIsOpen(false);
      setTitle('');
      setContent('');
      setKind('');
      onSubmitted();
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError('internal', String(err)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary">Сдать артефакт</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[620px]">
        <DialogHeader>
          <DialogTitle>Сдать артефакт</DialogTitle>
          <DialogDescription>Артефакт иммутабелен: правка сдаётся новой версией.</DialogDescription>
        </DialogHeader>
        {error ? <Failure error={error} title="Артефакт не принят" /> : null}
        <FormLayout>
          <Selector
            label="Вид"
            description={
              kinds.length ? 'Виды, которых ждут гейты этого статуса' : 'Гейты ничего не требуют'
            }
            options={kinds.map((k) => ({value: k, label: k}))}
            value={kind}
            onChange={setKind}
            hasClear
          />
          <TextInput label="Название" value={title} onChange={setTitle} />
          <TextArea label="Содержимое" value={content} onChange={setContent} rows={12} isRequired />
        </FormLayout>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setIsOpen(false)}>
            Отмена
          </Button>
          <Button disabled={!kind || !content || busy} onClick={submit}>
            Сдать
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
