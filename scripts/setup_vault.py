"""Create a new vault, never modify existing vaults."""
import argparse, json, shutil
from pathlib import Path
from common import ROOT, CONFIG, write_json, write_note, now

def setup(target):
    target=target.expanduser().resolve()
    if target.exists() and any(target.iterdir()): raise SystemExit('Target is not empty. Choose a new vault directory.')
    shutil.copytree(ROOT/'vault-starter', target, dirs_exist_ok=True)
    for name in ['Inbox','Writing','Library','Notes/Concepts','Notes/Evergreen','Reflections','Daily','Photos','Monthly','Notes/Radiology','Training/Activities','Training/Blocks','Media/Photos','Media/Audio','_System','Guide']:
        (target/name).mkdir(parents=True,exist_ok=True)
    projects=[('Pneumonia Image Lab','pneumonia-image-lab','https://vedants-agrawal.github.io/pneumonia-image-lab/',
      'A small convolutional neural network trained on 28 × 28 chest X-rays from PneumoniaMNIST. Explore feature maps, model calculations, test results, and the effect of changing the classification threshold.\n\n[Open the interactive lab](https://vedants-agrawal.github.io/pneumonia-image-lab/) · [Source code](https://github.com/VedantS-Agrawal/pneumonia-image-lab)\n\nThis is an educational benchmark experiment, not a clinically validated diagnostic tool.\n\nRelated: [[CheXNet, explained]]\n'),
      ('CheXNet, explained','chexnet-explained','https://vedants-agrawal.github.io/pneumonia-image-lab/paper/',
      'An interactive reading companion to *Reproducing and Improving CheXNet*. Explore focal loss, thresholds, patient splitting, calibration, and the difference between reported results and teaching simulations.\n\n[Open the paper companion](https://vedants-agrawal.github.io/pneumonia-image-lab/paper/) · [Source paper](https://arxiv.org/html/2505.06646v1)\n\nRelated: [[Pneumonia Image Lab]]\n')]
    state={'notes':{},'lastPublished':None}
    for title,ident,url,body in projects:
        rel=f'Notes/Radiology/{title}.md'
        write_note(target/rel,{'title':title,'type':'writing','visibility':'public','tags':['radiology','ml']},body)
        state['notes'][rel]={'slug':f'projects/{ident}'}
    write_json(target/'_System/publishing.json',state,True)
    write_json(ROOT/'site.local.json',{'vault':str(target)},True)
    print('Vault created: '+str(target))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('target',type=Path);setup(p.parse_args().target)
