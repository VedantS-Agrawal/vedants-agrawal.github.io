# Vedant Agrawal — Radiology Projects

Homepage: https://vedants-agrawal.github.io/

A lightweight project hub linking to:

- [Pneumonia Image Lab](https://vedants-agrawal.github.io/pneumonia-image-lab/)
- [CheXNet interactive paper guide](https://vedants-agrawal.github.io/pneumonia-image-lab/paper/)

## Edit and preview

Edit `dist/index.html` and `dist/style.css`. To add another project, add a card inside `.project-grid` with its title, description, and live URL.

```sh
python3 -m http.server 8767 --directory dist
```

Open http://localhost:8767. Pushes to `main` deploy `dist/` through GitHub Actions. This homepage has its own repository; the model and paper guide remain in `pneumonia-image-lab`.

## Attribution

The thumbnail is an unmodified 28×28 PneumoniaMNIST sample, distributed by MedMNIST under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Browser enlargement does not change the stored pixels.

- [MedMNIST](https://medmnist.com/) · [dataset record](https://zenodo.org/records/10519652)
- Yang et al., *MedMNIST v2*, Scientific Data (2023).
- Original source: Kermany et al., *Identifying Medical Diagnoses and Treatable Diseases by Image-Based Deep Learning*, Cell (2018).

The miniature network and paper graphics are schematic illustrations, not model outputs or reproduced study figures. Code is MIT-licensed; the license does not relicense dataset images or external fonts.
