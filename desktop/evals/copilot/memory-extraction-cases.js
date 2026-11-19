'use strict'

/*
 * Evaluation set for the desktop memory-extraction pass.
 *
 * Each case is the real input the pass sees: the last two messages of a thread,
 * a person's turn then the assistant's reply. The cases cover the four kinds the
 * prompt allows, the two negatives the prompt spends most of its words on
 * (assistant suggestions and answered questions), and three moments the pass was
 * observed to get wrong in the app. Tokens are the part of the meaning that
 * cannot be paraphrased away, so a correct answer worded differently still passes.
 */

module.exports = {
  feature: 'memory_extraction',
  promptConstant: 'EXTRACTION_PROMPT',
  cases: [
    {
      id: 'mem-01',
      title: 'A stated decision is stored as a decision',
      origin: 'plan-section-8',
      exchange: [
        { role: 'user', content: 'We decided to hold the Tilley invoice until Friday.' },
        { role: 'assistant', content: 'Understood - the invoice stays unpaid until Friday.' },
      ],
      expect: {
        items: [
          { label: 'the decision about the invoice is stored', kind: 'decision', all: ['invoice', 'friday'] },
        ],
        maxItems: 2,
      },
    },
    {
      id: 'mem-02',
      title: 'A stated number is stored as a fact',
      origin: 'plan-section-8',
      exchange: [
        { role: 'user', content: 'Our shop rent is 450,000 naira a month.' },
        { role: 'assistant', content: 'Noted - the shop rent is 450,000 naira a month.' },
      ],
      expect: {
        items: [
          { label: 'the rent figure is stored as a fact', kind: 'fact', all: ['rent', '450'] },
        ],
        maxItems: 2,
      },
    },
    {
      id: 'mem-03',
      title: 'A stated role is stored as a fact',
      origin: 'plan-section-8',
      exchange: [
        { role: 'user', content: 'My brother runs the Lagos shop day to day.' },
        { role: 'assistant', content: 'Got it - your brother is the one running the Lagos shop.' },
      ],
      expect: {
        items: [
          { label: 'the family role for the Lagos shop is stored', kind: 'fact', all: ['brother', 'lagos'] },
        ],
        maxItems: 2,
      },
    },
    {
      id: 'mem-04',
      title: 'A decision tied to a date keeps the date',
      origin: 'plan-section-8',
      exchange: [
        { role: 'user', content: 'We decided to move the stock count to the fourteenth of March.' },
        { role: 'assistant', content: 'Understood - the stock count moves to the fourteenth of March.' },
      ],
      expect: {
        items: [
          { label: 'the stock count decision keeps its date', kind: 'decision', all: ['stock', 'march'] },
        ],
        maxItems: 2,
      },
    },
    {
      id: 'mem-05',
      title: 'A supplier detail is stored as a fact',
      origin: 'plan-section-8',
      exchange: [
        { role: 'user', content: 'All our cartons come from a packaging supplier in Kano.' },
        { role: 'assistant', content: 'Noted - the packaging supplier is in Kano.' },
      ],
      expect: {
        items: [
          { label: 'the packaging supplier location is stored', kind: 'fact', all: ['packaging', 'kano'] },
        ],
        maxItems: 2,
      },
    },
    {
      id: 'mem-06',
      title: 'A price the person gave is stored as a fact',
      origin: 'plan-section-8',
      exchange: [
        { role: 'user', content: 'The new freezer cost us 800,000 naira.' },
        { role: 'assistant', content: 'Recorded - the freezer came to 800,000 naira.' },
      ],
      expect: {
        items: [
          { label: 'the freezer price is stored as a fact', kind: 'fact', all: ['freezer', '800'] },
        ],
        maxItems: 2,
      },
    },
    {
      id: 'mem-07',
      title: 'Something the person is assuming is not stored as a fact',
      origin: 'plan-section-8',
      exchange: [
        { role: 'user', content: 'I am assuming the bank will clear the transfer by Wednesday.' },
        { role: 'assistant', content: 'Understood - you are working on that assumption.' },
      ],
      expect: {
        items: [
          { label: 'the waiting transfer is stored as an assumption', kind: 'assumption', all: ['bank', 'wednesday'] },
        ],
        maxItems: 2,
      },
    },
    {
      id: 'mem-08',
      title: 'A stated assumption about the lease keeps the landlord and the lease',
      origin: 'plan-section-8',
      exchange: [
        { role: 'user', content: 'I am assuming the landlord will renew the lease in June.' },
        { role: 'assistant', content: 'Noted - that is your working assumption for June.' },
      ],
      expect: {
        items: [
          { label: 'the lease assumption is stored as an assumption', kind: 'assumption', all: ['landlord', 'lease'] },
        ],
        maxItems: 2,
      },
    },
    {
      id: 'mem-09',
      title: 'A long-running assumption is stored as an assumption',
      origin: 'plan-section-8',
      exchange: [
        { role: 'user', content: 'We are working on the assumption that the generator lasts until December.' },
        { role: 'assistant', content: 'Understood - the generator is expected to last until December.' },
      ],
      expect: {
        items: [
          { label: 'the generator expectation is stored as an assumption', kind: 'assumption', all: ['generator', 'december'] },
        ],
        maxItems: 2,
      },
    },
    {
      id: 'mem-10',
      title: 'An assumption about training time is stored as an assumption',
      origin: 'plan-section-8',
      exchange: [
        { role: 'user', content: 'I am assuming the new staff will need two weeks of training.' },
        { role: 'assistant', content: 'Got it - two weeks of training is the plan of record for now.' },
      ],
      expect: {
        items: [
          { label: 'the training estimate is stored as an assumption', kind: 'assumption', all: ['staff', 'training'] },
        ],
        maxItems: 2,
      },
    },
    {
      id: 'mem-11',
      title: 'An unresolved question about the Tilley deposit is stored as an open question',
      origin: 'observed-miss',
      exchange: [
        { role: 'user', content: 'I still do not know whether the Tilley deposit has been paid.' },
        { role: 'assistant', content: 'I have no record of that either.' },
      ],
      expect: {
        items: [
          { label: 'the open question about the Tilley deposit is stored as a question', kind: 'open_question', all: ['tilley', 'deposit'] },
        ],
        maxItems: 2,
      },
    },
    {
      id: 'mem-12',
      title: 'An unresolved sign-off question is stored as an open question',
      origin: 'observed-miss',
      exchange: [
        { role: 'user', content: 'Nobody has confirmed who signs off the Abuja budget.' },
        { role: 'assistant', content: 'Then that is still open.' },
      ],
      expect: {
        items: [
          { label: 'the open question about the Abuja sign-off is stored as a question', kind: 'open_question', all: ['abuja', 'budget'] },
        ],
        maxItems: 2,
      },
    },
    {
      id: 'mem-13',
      title: 'An unknown opening date is stored as an open question',
      origin: 'plan-section-8',
      exchange: [
        { role: 'user', content: 'We still do not know the opening date for the Kano shop.' },
        { role: 'assistant', content: 'Understood - that date is still open.' },
      ],
      expect: {
        items: [
          { label: 'the open question about the opening date is stored as a question', kind: 'open_question', all: ['kano', 'shop'] },
        ],
        maxItems: 2,
      },
    },
    {
      id: 'mem-14',
      title: 'An unconfirmed delivery is stored as an open question',
      origin: 'plan-section-8',
      exchange: [
        { role: 'user', content: 'We still do not know if the cement supplier will deliver before the weekend.' },
        { role: 'assistant', content: 'That one is still outstanding then.' },
      ],
      expect: {
        items: [
          { label: 'the open question about the cement delivery is stored as a question', kind: 'open_question', all: ['cement', 'supplier'] },
        ],
        maxItems: 2,
      },
    },
    {
      id: 'mem-15',
      title: 'An assistant offer that the person only agrees to is not stored',
      origin: 'plan-section-8',
      exchange: [
        { role: 'user', content: 'Sure, do that.' },
        { role: 'assistant', content: 'I will draft a reminder to the team about the late stock report.' },
      ],
      expect: {
        silent: true,
      },
    },
    {
      id: 'mem-16',
      title: 'An assistant suggestion the person says yes to is not stored',
      origin: 'plan-section-8',
      exchange: [
        { role: 'user', content: 'Good idea, go ahead with that.' },
        { role: 'assistant', content: 'I will put together a one page summary of the week every Friday.' },
      ],
      expect: {
        silent: true,
      },
    },
    {
      id: 'mem-17',
      title: 'An assistant proposal accepted with a nod is not stored',
      origin: 'plan-section-8',
      exchange: [
        { role: 'user', content: 'Yes, that works, do it that way.' },
        { role: 'assistant', content: 'I will move the team meeting to the afternoon so the morning stays clear.' },
      ],
      expect: {
        silent: true,
      },
    },
    {
      id: 'mem-18',
      title: 'A question the assistant answered is not stored',
      origin: 'plan-section-8',
      exchange: [
        { role: 'user', content: 'How many items are still on the March invoice?' },
        { role: 'assistant', content: 'There are four items left on the March invoice.' },
      ],
      expect: {
        silent: true,
      },
    },
    {
      id: 'mem-19',
      title: 'An answered question about opening hours is not stored',
      origin: 'plan-section-8',
      exchange: [
        { role: 'user', content: 'What time does the Kano depot open on Saturday?' },
        { role: 'assistant', content: 'It opens at eight in the morning on Saturday.' },
      ],
      expect: {
        silent: true,
      },
    },
    {
      id: 'mem-20',
      title: 'An answered yes or no question is not stored',
      origin: 'plan-section-8',
      exchange: [
        { role: 'user', content: 'Did we send the purchase order to the cement supplier?' },
        { role: 'assistant', content: 'Yes, the purchase order went out to the cement supplier yesterday.' },
      ],
      expect: {
        silent: true,
      },
    },
    {
      id: 'mem-21',
      title: 'A closing thank you is not stored as an item',
      origin: 'observed-miss',
      exchange: [
        { role: 'user', content: 'Thanks, that is all for now.' },
        { role: 'assistant', content: 'You are welcome.' },
      ],
      expect: {
        silent: true,
      },
    },
    {
      id: 'mem-22',
      title: 'A plain thank you at the end of a thread is not stored',
      origin: 'plan-section-8',
      exchange: [
        { role: 'user', content: 'Great, that helps, thank you.' },
        { role: 'assistant', content: 'Glad it helped.' },
      ],
      expect: {
        silent: true,
      },
    },
    {
      id: 'mem-23',
      title: 'A quoted fact is stored without the name of the person who said it',
      origin: 'plan-section-8',
      exchange: [
        { role: 'user', content: 'Chinedu said the roof quote is two million naira.' },
        { role: 'assistant', content: 'Understood - the roof quote is two million naira.' },
      ],
      expect: {
        items: [
          { label: 'the roof quote is stored as a fact', kind: 'fact', all: ['roof', 'quote'] },
        ],
        forbidden: [
          { label: 'the name is not stored', all: ['chinedu'] },
        ],
        maxItems: 2,
      },
    },
    {
      id: 'mem-24',
      title: 'An exchange with an email address is never sent to the model',
      origin: 'plan-section-8',
      exchange: [
        { role: 'user', content: 'Send the updated catalogue to ops@example.com please.' },
        { role: 'assistant', content: 'I will send the catalogue to that address.' },
      ],
      expect: {
        preSendBlocked: 'email',
      },
    },
  ],
}
