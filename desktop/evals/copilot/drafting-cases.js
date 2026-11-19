'use strict'

/*
 * Evaluation cases for the task-drafting pass.
 *
 * Each case is one person message run through the shipped DRAFTING_PROMPT, and
 * the cards the app would store are judged by expectations.js. The set covers
 * the plain request, the request that has to be split, an explicit date, an
 * explicit owner or project, turns that must stay silent, and the two shapes
 * that previously produced no card at all. No message asks for a deadline, an
 * owner or a project it does not name, so inventing one is always a failure.
 */

module.exports = {
  feature: 'task_drafting',
  promptConstant: 'DRAFTING_PROMPT',
  cases: [
    {
      id: 'draft-01',
      title: 'A plain add request becomes one card',
      origin: 'plan-section-12',
      message: 'Add a task to call the surveyor.',
      reach: 'should-draft',
      expect: {
        tasks: [
          { label: 'the call to the surveyor is drafted', all: ['surveyor'] },
        ],
        exactCount: 1,
        dueHint: 'absent',
      },
    },
    {
      id: 'draft-02',
      title: 'A create request becomes one card',
      origin: 'plan-section-12',
      message: 'Create a task to renew the insurance certificate.',
      reach: 'should-draft',
      expect: {
        tasks: [
          { label: 'the insurance renewal is drafted', all: ['insurance'] },
        ],
        exactCount: 1,
        dueHint: 'absent',
      },
    },
    {
      id: 'draft-03',
      title: 'A draft request becomes one card',
      origin: 'plan-section-12',
      message: 'Draft a task for ordering more paint for the lobby.',
      reach: 'should-draft',
      expect: {
        tasks: [
          { label: 'the paint order is drafted', all: ['paint'] },
        ],
        exactCount: 1,
        dueHint: 'absent',
      },
    },
    {
      id: 'draft-04',
      title: 'A put-together request becomes one card',
      origin: 'plan-section-12',
      message: 'Put together a task to file the VAT return.',
      reach: 'should-draft',
      expect: {
        tasks: [
          { label: 'the VAT return filing is drafted', all: ['vat'] },
        ],
        exactCount: 1,
        dueHint: 'absent',
      },
    },
    {
      id: 'draft-05',
      title: 'A set-up request becomes one card',
      origin: 'plan-section-12',
      message: 'Set up a task to book the boiler service.',
      reach: 'should-draft',
      expect: {
        tasks: [
          { label: 'the boiler service booking is drafted', all: ['boiler'] },
        ],
        exactCount: 1,
        dueHint: 'absent',
      },
    },
    {
      id: 'draft-06',
      title: 'A make request becomes one card',
      origin: 'plan-section-12',
      message: 'Make a task to update the client contact list.',
      reach: 'should-draft',
      expect: {
        tasks: [
          { label: 'the contact list update is drafted', all: ['contact'] },
        ],
        exactCount: 1,
        dueHint: 'absent',
      },
    },
    {
      id: 'draft-07',
      title: 'Two clauses named in one sentence become two cards',
      origin: 'plan-section-12',
      message: 'Add a task to chase the invoice and one to book the site visit.',
      reach: 'should-draft',
      expect: {
        tasks: [
          { label: 'the invoice chase is its own card', all: ['invoice'] },
          { label: 'the site visit booking is its own card', all: ['site visit'] },
        ],
        distinct: true,
        exactCount: 2,
        dueHint: 'absent',
      },
    },
    {
      id: 'draft-08',
      title: 'Two tasks joined by and are split apart',
      origin: 'plan-section-12',
      message: 'Create a task to order the fencing panels and a task to ring the landlord.',
      reach: 'should-draft',
      expect: {
        tasks: [
          { label: 'the fencing panel order is its own card', all: ['fencing'] },
          { label: 'the call to the landlord is its own card', all: ['landlord'] },
        ],
        distinct: true,
        exactCount: 2,
        dueHint: 'absent',
      },
    },
    {
      id: 'draft-09',
      title: 'A list of three asked-for tasks becomes three cards',
      origin: 'plan-section-12',
      message: 'Add three tasks: confirm the delivery slot, print the posters, and email the client the agenda.',
      reach: 'should-draft',
      expect: {
        tasks: [
          { label: 'the delivery slot is its own card', all: ['delivery'] },
          { label: 'the poster printing is its own card', all: ['poster'] },
          { label: 'the agenda email is its own card', all: ['agenda'] },
        ],
        distinct: true,
        exactCount: 3,
        dueHint: 'absent',
      },
    },
    {
      id: 'draft-10',
      title: 'A review task and a send task stay separate',
      origin: 'plan-section-12',
      message: 'Draft a task to review the quotes and another to send the deposit request to the supplier.',
      reach: 'should-draft',
      expect: {
        tasks: [
          { label: 'the quote review is its own card', all: ['quote'] },
          { label: 'the deposit request is its own card', all: ['deposit'] },
        ],
        distinct: true,
        exactCount: 2,
        dueHint: 'absent',
      },
    },
    {
      id: 'draft-11',
      title: 'A stated day number is carried as the due hint',
      origin: 'plan-section-12',
      message: 'Add a task to submit the tender documents before the 14th.',
      reach: 'should-draft',
      expect: {
        tasks: [
          { label: 'the tender submission is drafted', all: ['tender'] },
        ],
        exactCount: 1,
        dueHint: 'present',
      },
    },
    {
      id: 'draft-12',
      title: 'A stated weekday is carried as the due hint',
      origin: 'plan-section-12',
      message: 'Create a task to call the plumber by Friday.',
      reach: 'should-draft',
      expect: {
        tasks: [
          { label: 'the call to the plumber is drafted', all: ['plumber'] },
        ],
        exactCount: 1,
        dueHint: 'present',
      },
    },
    {
      id: 'draft-13',
      title: 'A named owner is kept and no project is invented',
      origin: 'plan-section-12',
      message: 'Add a task to clear the store room and assign it to Ada.',
      reach: 'should-draft',
      expect: {
        tasks: [
          {
            label: 'the store room task is drafted with Ada as the owner',
            all: ['room', 'ada'],
          },
        ],
        exactCount: 1,
        dueHint: 'absent',
        forbidInText: [
          { label: 'no project is invented', all: ['abuja'] },
        ],
      },
    },
    {
      id: 'draft-14',
      title: 'A named project is kept and no owner is invented',
      origin: 'plan-section-12',
      message: 'Create a task to chase the outstanding survey report and put it under the Abuja retail project.',
      reach: 'should-draft',
      expect: {
        tasks: [
          {
            label: 'the survey report task is drafted under the Abuja retail project',
            all: ['survey', 'abuja'],
          },
        ],
        exactCount: 1,
        dueHint: 'absent',
        forbidInText: [
          { label: 'no owner is invented', all: ['ada'] },
        ],
      },
    },
    {
      id: 'draft-15',
      title: 'A second named owner is kept and no project is invented',
      origin: 'plan-section-12',
      message: 'Draft a task to sign off the delivery notes and assign it to Chidi.',
      reach: 'should-draft',
      expect: {
        tasks: [
          {
            label: 'the delivery notes task is drafted with Chidi as the owner',
            all: ['delivery', 'chidi'],
          },
        ],
        exactCount: 1,
        dueHint: 'absent',
        forbidInText: [
          { label: 'no project is invented', all: ['abuja'] },
        ],
      },
    },
    {
      id: 'draft-16',
      title: 'A status question drafts nothing',
      origin: 'plan-section-12',
      message: 'What is overdue this week?',
      reach: 'should-stay-silent',
      expect: { silent: true },
    },
    {
      id: 'draft-17',
      title: 'A summary request drafts nothing',
      origin: 'plan-section-12',
      message: 'Summarise where we are on the lease.',
      reach: 'should-stay-silent',
      expect: { silent: true },
    },
    {
      id: 'draft-18',
      title: 'A greeting drafts nothing',
      origin: 'plan-section-12',
      message: 'Good morning',
      reach: 'should-stay-silent',
      expect: { silent: true },
    },
    {
      id: 'draft-19',
      title: 'A deletion request drafts nothing',
      origin: 'plan-section-12',
      message: 'Delete the old surveyor task.',
      reach: 'should-stay-silent',
      expect: { silent: true },
    },
    {
      id: 'draft-20',
      title: 'Thinking out loud drafts nothing',
      origin: 'plan-section-12',
      message: 'We need to think about hiring.',
      reach: 'should-stay-silent',
      expect: { silent: true },
    },
    {
      id: 'draft-21',
      title: 'A reminder with a weekday still becomes a card',
      origin: 'observed-miss',
      message: 'Remind me to call the surveyor on Monday.',
      reach: 'should-draft',
      expect: {
        tasks: [
          { label: 'the reminder becomes a card', all: ['surveyor'] },
        ],
        exactCount: 1,
      },
    },
    {
      id: 'draft-22',
      title: 'A need stated as a task becomes a card',
      origin: 'observed-miss',
      message: 'I need a task to review the lease renewal before March.',
      reach: 'should-draft',
      expect: {
        tasks: [
          { label: 'the lease renewal review is drafted', all: ['lease'] },
        ],
        exactCount: 1,
      },
    },
    {
      id: 'draft-23',
      title: 'A dateless request gains no tomorrow',
      origin: 'plan-section-12',
      message: 'Set up a task to sort the receipts for the accountant.',
      reach: 'should-draft',
      expect: {
        tasks: [
          { label: 'the receipts task is drafted', all: ['receipt'] },
        ],
        exactCount: 1,
        dueHint: 'absent',
        forbidInText: [
          { label: 'no deadline is invented', all: ['tomorrow'] },
        ],
      },
    },
    {
      id: 'draft-24',
      title: 'A dateless request gains no Friday',
      origin: 'plan-section-12',
      message: 'Put a task on my list to print the induction packs.',
      reach: 'should-draft',
      expect: {
        tasks: [
          { label: 'the induction packs task is drafted', all: ['induction'] },
        ],
        exactCount: 1,
        dueHint: 'absent',
        forbidInText: [
          { label: 'no deadline is invented', all: ['friday'] },
        ],
      },
    },
  ],
}
