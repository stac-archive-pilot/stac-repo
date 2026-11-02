# PolyFT

## Overview 
The POLYFT_IDGRP folder contains files related to PolyFT. 
PolyFT is an associative fluency task that uses polysemous words as cues for a free-associative memory search. It enables examination of clustering and switching among different meanings, and investigates how individuals search their memory, alternating between exploration and exploitation, and combining associative and controlled processes. These memory search processes are particularly relevant to idea generation.

In the PolyFT task, participants are required to list all the words they can think of associated with a given cue word (i.e., single-word associations) within 1,5 minutes (computerized version). As cue words, we selected ambiguous, polysemous French words with high lexical frequency (> 20 occurrences per million in a large corpus, according to the French lexicon project, http://www.lexique.org/) and at least three distinct meanings, according to the French dictionary (Supplementary Table 1). The list of meanings for each cue was compiled using a French linguistic research resource (Centre National de Ressources Textuelles et Lexicales; https://www.cnrtl.fr/). For each cue word, participants generated words associated with the cue word, without being informed that the words had different meanings. 

Contact: emmavolle@gmail.com

## Files

- **POLYFT_IDGRP.zip** The zip file  contains all relevant files for the task, including:
- Readme.doc: detailed readme file showing how to administer and analyze the task
- gui_EN.m:
- gui_FR.m:
- main.m: main script
- IDGRP.pptx: instructions for the identification of the switches and clusters by the participants
- Main_Instructions.pptx: instructions for the task
- PolyF.pptx: instructions for PolyFT
- Params_table.xlsx: main parameters of the task
Calls various scripts in the subfolders:
+DisplayFct
+MainTaskFct
+OtherFct
+Parameters
Analyses
Lists

## Administration and Scoring

Administration: Please include a training on a few new cue-words before starting the experiment
You can run the task with or without IDGRP (identification of the switches and clusters by the participants).

Scoring: In brief, we categorize each produced response as belonging to one of the meanings of each cue word. Using this classification, we identify clustering responses as those that refer to the same meaning as the previous response, and switching responses as those that refer to a different meaning.
You can run the task with or without IDGRP (identification of the switches and clusters by the participants).
Please note that automated classification will be available soon.
Several measures can be computed depending on the research aims. Please see the references below for details
Please also see Readme.doc in the POLYFT_IDGRP folder 

## Citation 
If you use this measure in your published work, please cite the reference(s) below: 

M. Ovando-Tellez, M. Benedek, YN. Kenett, T. Hills, S. Bouanane, M. Bernard, J. Belo, T. Bieth, E. Volle. An investigation of the cognitive and neural correlates of semantic memory search related to creative ability. Communication Biology. 2022. 5 :1-16. https://doi.org/10.1038/s42003-022-03547-x.
M. Ovando-Tellez*, L. Vigreux*, YN. Kenett, M. Benedek, T. Hills, B. Beranger, A. Lopez-Persem, V. Altmayer, T. Bieth, E. Volle. Switching, fast and slow: deciphering the dynamics of memory search, its brain connectivity, and its role in creativity. Imaging Neuroscience. 2025. 3: IMAG.a.1018. https://doi.org/10.1162/IMAG.a.1018.

## Licensing
All files within this folder are free to use for academic and non-commercial purposes. Refer to the project's Wiki for more detailed information regarding licensing and usage permissions [project's Wiki](https://osf.io/4s9p6/wiki/home/).