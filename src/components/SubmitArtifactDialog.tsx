import {useState} from 'react';
import {Button} from '@astryxdesign/core/Button';
import {Dialog, DialogHeader} from '@astryxdesign/core/Dialog';
import {FormLayout} from '@astryxdesign/core/FormLayout';
import {HStack, VStack} from '@astryxdesign/core/Layout';
import {Selector} from '@astryxdesign/core/Selector';
import {TextArea} from '@astryxdesign/core/TextArea';
import {TextInput} from '@astryxdesign/core/TextInput';

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
  const [kind, setKind] = useState<string | null>(null);
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
      setKind(null);
      onSubmitted();
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError('internal', String(err)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button variant="secondary" label="Сдать артефакт" onClick={() => setIsOpen(true)} />
      <Dialog isOpen={isOpen} onOpenChange={setIsOpen} purpose="form" width={620} padding={5}>
        <VStack gap={4}>
          <DialogHeader title="Сдать артефакт" />
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
              isRequired
            />
            <TextInput label="Название" value={title} onChange={setTitle} />
            <TextArea label="Содержимое" value={content} onChange={setContent} rows={12} isRequired />
          </FormLayout>
          <HStack gap={2} hAlign="end">
            <Button variant="ghost" label="Отмена" onClick={() => setIsOpen(false)} />
            <Button
              variant="primary"
              label="Сдать"
              isDisabled={!kind || !content || busy}
              onClick={submit}
            />
          </HStack>
        </VStack>
      </Dialog>
    </>
  );
}
