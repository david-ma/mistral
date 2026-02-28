Building off of the Mistral plan, we want to create a bingo card generator.
Tidy up this file, break it down into steps. Especially "MVP" and "Future Features".

We need a few new models for this.
Let's keep them all in the same file, /usr/local/dev/Thalia/websites/smugmug/models/bingo.ts

I've added two new models to the file, events and bingo_cards.
Do we need any more?

I think we need to have an admin page (list-events) to list all the events, and allow an admin to create new events.

We'll use an admin page (edit-event) for admins to edit the event, on this page admins can add/edit/delete prompts.
In future the admins will use this page to view all bingo cards for an event, and especially review images and descriptions, to see if they match the prompt. We will use the mistral-describe API to generate descriptions, and ask mistral if the description matches the prompt.

Future feature: Admins should be able to ban users.

Then the (show-event) page should show the event details to anyone, and allow people to join the event.
For the MVP, people don't need to be logged in to join an event. They can contribute to any bingo card.

In future, people will need to be logged in to join an event, and will only be able to contribute to their own bingo card.

