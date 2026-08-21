# Separate Deterministic Results From Product Learning

Package-owned deterministic checks are the only authority for attempt outcomes.
Recommendations, model analysis, and user feedback remain advisory and cannot
change a stored result. Automatic self-training could make outcomes depend on
unreviewed or poisoned feedback, which would defeat reproducibility and the
product's evidence contract.

Feedback can create a curated improvement dataset. Changes to checks require a
reviewed, tested, and versioned release. Later model-generated recommendations
must cite evidence, declare confidence, and provide a validation step.
