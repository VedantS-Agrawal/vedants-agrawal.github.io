---
title: Principal component analysis
type: concept
date: '2023-12-27'
published: '2026-10-16T14:47:19-05:00'
updated: '2026-10-16'
created: '2026-10-16T14:47:19-05:00'
modified: '2026-10-16'
aliases:
- PCA
---

A dimensionality-reduction method: re-express many variables as a smaller set of uncorrelated linear combinations of them.

The steps:
- Fit a line of best fit through the data. The vector along it is an *eigenvector*; the proportions of each variable in it are the *loading scores*.
- The eigenvectors and *eigenvalues* come from the covariance matrix — variances on the diagonal, covariances off it.
- An eigenvalue is the variance captured by that component. All eigenvalues sum to the total variance of the original variables, so each one's share is the percentage of variation it explains.
- Project the data onto the eigenvectors with the largest eigenvalues. A scree plot shows the variation per component; a common cutoff is eigenvalue > 1.

Things to remember:
- You can have as many components as original variables.
- PCA does nothing if the original variables aren't correlated.
- Kaiser-Meyer-Olkin tests whether variables are factorable: overall > 0.5, individual > 0.8.
