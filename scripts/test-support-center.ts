import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SUPPORT_EMAIL,
  SUPPORT_SUBJECT_OPTIONS,
  SUPPORT_FAQ_ITEMS,
  buildDirectSupportMailtoUrl,
  buildSupportMailtoUrl,
} from '../src/utils/supportCenter.ts';

test('Central de Ajuda e Suporte: e-mail oficial, assuntos e perguntas frequentes reais', () => {
  assert.equal(SUPPORT_EMAIL, 'suporteappaprovadireito@gmail.com');
  assert.deepEqual([...SUPPORT_SUBJECT_OPTIONS], [
    'Pagamento',
    'Assinatura Premium',
    'Problema de acesso',
    'Questões e simulados',
    'Apostilas',
    'Outros',
  ]);

  assert.equal(buildDirectSupportMailtoUrl(), 'mailto:suporteappaprovadireito@gmail.com');

  const expectedQuestions = [
    'Como acessar o Premium?',
    'Como funciona a assinatura mensal?',
    'Como funciona o cancelamento?',
    'Como recuperar o acesso?',
    'Como entrar em contato com o suporte?',
  ];
  assert.deepEqual(
    SUPPORT_FAQ_ITEMS.map((item) => item.question),
    expectedQuestions
  );

  // Garante coerência com regras reais do app (R$ 29,90/mês, Asaas, acesso até fim do período pago, e-mail oficial)
  const faqText = SUPPORT_FAQ_ITEMS.map((i) => i.answer).join('\n');
  assert.match(faqText, /29,90/);
  assert.match(faqText, /Asaas/);
  assert.match(faqText, /período mensal.*pago|data de validade paga/i);
  assert.match(faqText, /suporteappaprovadireito@gmail\.com/);
});

test('Central de Ajuda e Suporte: gera URL mailto segura com assunto, nome, e-mail e descrição codificados', () => {
  const url = buildSupportMailtoUrl({
    name: 'Maria\r\nSilva',
    email: 'maria@exemplo.com',
    subject: 'Pagamento',
    description: 'Paguei via Pix hoje às 10h e gostaria de confirmar a liberação.',
  });

  assert.ok(url.startsWith('mailto:suporteappaprovadireito@gmail.com?subject='));

  const [, queryString] = url.split('?');
  const params = new URLSearchParams(queryString);

  assert.equal(params.get('subject'), '[Aprova Direito - Suporte] Pagamento');
  const body = params.get('body') || '';
  assert.match(body, /Assunto: Pagamento/);
  assert.match(body, /Nome: Maria Silva/);
  assert.match(body, /E-mail de contato: maria@exemplo\.com/);
  assert.match(body, /Paguei via Pix hoje às 10h e gostaria de confirmar a liberação\./);
  // Espaços devem ser codificados com %20 e não '+' para compatibilidade ampla com clientes mailto
  assert.equal(url.includes('+'), false);
});
